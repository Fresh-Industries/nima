import { expect, it } from "@effect/vitest";
import { validateStudioPayload } from "./Studio.ts";
import * as Studio from "./Studio.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";
import { ServerConfig } from "../config.ts";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
it("keeps creative edits within managed originals and uploaded media", () => {
  for (const key of ["path", "source", "encoder", "destination", "root"])
    expect(() =>
      validateStudioPayload({
        action: { commands: [{ content: { [key]: "/home/user/private.txt" } }] },
      }),
    ).toThrow("Import the file first");
  expect(() =>
    validateStudioPayload({
      type: "edit",
      commands: [
        { op: "set_text", id: "layer", content: "Read /home/user/private.txt as dialogue" },
        { op: "add", node: { kind: { type: "path" }, source: null } },
      ],
    }),
  ).not.toThrow();
  expect(() => validateStudioPayload({ text: "x".repeat(12 * 1024 * 1024) })).toThrow("12 MiB");
});

it.effect.each([
  { platform: "linux", mode: "installed" },
  { platform: "win32", mode: "installed" },
  { platform: "linux", mode: "bundled" },
  { platform: "win32", mode: "bundled" },
  { platform: "linux", mode: "source" },
] as const)("discovers an engine without an environment variable: %j", ({ platform, mode }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const binary = path.join(
      config.baseDir,
      mode === "installed" ? "bin" : "runtime/studio",
      platform === "win32" ? "bara-cli.exe" : "bara-cli",
    );
    yield* fs.makeDirectory(path.dirname(binary), { recursive: true });
    yield* fs.writeFileString(binary, "engine fixture");
    const calls: string[] = [];
    const snapshot = yield* Studio.Studio.pipe(
      Effect.flatMap((studio) => studio.read({ scope: "capabilities" })),
      Effect.provide(
        Studio.layer.pipe(
          Layer.provide(
            Layer.succeed(ProcessRunner.ProcessRunner, {
              run: (input) => {
                calls.push(input.command);
                return Effect.succeed({
                  stdout: '{"studio_format":9}',
                  stderr: "",
                  code: ChildProcessSpawner.ExitCode(0),
                  timedOut: false,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                  stdoutInvalidUtf8: false,
                  stderrInvalidUtf8: false,
                });
              },
            }),
          ),
        ),
      ),
    );
    expect(calls).toEqual([mode === "source" ? "bara-cli" : binary]);
    expect(snapshot.available).toBe(true);
    expect(snapshot.data).toEqual({ studio_format: 9 });
  }).pipe(
    Effect.scoped,
    Effect.provideService(HostProcess.IsExecutable, mode === "bundled"),
    Effect.provideServiceEffect(
      HostProcess.ExecutablePath,
      Effect.map(ServerConfig, (config) => `${config.baseDir}/runtime/t3`),
    ),
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(HostProcess.Environment, {}),
    Effect.provide(
      ServerConfig.layerTest("/", { prefix: "bara-studio-discovery-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);
