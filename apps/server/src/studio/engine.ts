import { StudioError } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Duration from "effect/Duration";
import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const isStudioError = Schema.is(StudioError);
export const studioFailure = (cause: unknown) =>
  isStudioError(cause)
    ? cause
    : new StudioError({
        detail:
          cause instanceof Error ? cause.message : "Studio could not complete this operation.",
      });
const resolveStudioBinary = Effect.fn("Studio.resolveBinary")(function* () {
  const config = yield* ServerConfig,
    environment = yield* HostProcess.Environment,
    platform = yield* HostProcess.Platform,
    fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  if (environment.BARA_STUDIO_CLI?.trim()) return environment.BARA_STUDIO_CLI.trim();
  const name = platform === "win32" ? "bara-cli.exe" : "bara-cli",
    installed = path.join(config.baseDir, "bin", name);
  return (yield* fs.exists(installed)) ? installed : name;
});
const resolveStudioEncoder = Effect.fn("Studio.resolveEncoder")(function* () {
  const environment = yield* HostProcess.Environment,
    platform = yield* HostProcess.Platform,
    fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = environment.BARA_STUDIO_FFMPEG
    ? [environment.BARA_STUDIO_FFMPEG]
    : (environment.PATH ?? environment.Path ?? "")
        .split(platform === "win32" ? ";" : ":")
        .filter(Boolean)
        .map((folder) => path.join(folder, name));
  if (platform === "darwin") candidates.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  for (const candidate of candidates)
    if (yield* fs.exists(candidate)) return yield* fs.realPath(candidate);
  return yield* new StudioError({
    detail: "Install FFmpeg on this Bara server to export video, or configure BARA_STUDIO_FFMPEG.",
  });
});
export const runStudio = Effect.fn("Studio.run")(function* (
  args: ReadonlyArray<string>,
  options: { json?: boolean; timeout?: Duration.Input } = {},
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const result = yield* runner.run({
    command: yield* resolveStudioBinary(),
    args,
    timeout: options.timeout ?? "5 minutes",
    maxOutputBytes: 48 * 1024 * 1024,
  });
  if (result.code !== 0)
    return yield* new StudioError({
      detail: result.stderr.trim().slice(-1200) || "The Bara engine rejected this operation.",
    });
  return options.json === false
    ? result.stdout.trim()
    : yield* Effect.try(() => decodeJson(result.stdout));
}, Effect.mapError(studioFailure));

export const makeStudioEngine = Effect.gen(function* () {
  const context = yield* Effect.context<Effect.Services<ReturnType<typeof runStudio>>>();
  return {
    run: (args: ReadonlyArray<string>, options?: { json?: boolean; timeout?: Duration.Input }) =>
      runStudio(args, options).pipe(Effect.provide(context)),
    resolveEncoder: () => resolveStudioEncoder().pipe(Effect.provide(context)),
  };
});
