import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { StudioError, StudioId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { createPendingAttachmentId } from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Recordings from "./Recordings.ts";
import * as Studio from "./Studio.ts";

const id = StudioId.make("11111111-1111-4111-8111-111111111111");
const request = StudioId.make("22222222-2222-4222-8222-222222222222");
const edited = StudioId.make("33333333-3333-4333-8333-333333333333");
const isStudioError = Schema.is(StudioError);
const json = Schema.encodeSync(Schema.fromJsonString(Schema.Json)),
  parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));
const object = (value: Schema.Json): Record<string, Schema.Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Schema.Json>)
    : {};

it.effect(
  "preserves recording originals, isolates paths, rejects stale edits and streams large exports",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        config = yield* ServerConfig;
      const python = path.join(config.baseDir, "bin", "transcriber", "python"),
        model = path.join(config.baseDir, "models", "whisper-tiny", "model.bin");
      for (const file of [python, model]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "fixture");
      }
      const attachmentId = createPendingAttachmentId("mp4");
      yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(config.attachmentsDir, attachmentId + ".mp4"),
        "original fixture",
      );
      const entered = yield* Deferred.make<void>(),
        complete = yield* Deferred.make<void>();
      let calls = 0;
      const clip = {
        format: 1,
        source: "/managed/source.mp4",
        source_sha256: "fixture",
        source_bytes: 16,
        duration_ms: 2000,
        cues: [{ start_ms: 0, end_ms: 1000, text: "Hello Bara" }],
        in_ms: 0,
        out_ms: 2000,
      };
      const runner = Layer.succeed(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.gen(function* () {
            let stdout = "{}";
            if (input.args[0] === "recording-transcribe") {
              calls++;
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(complete);
              stdout = json(clip);
            } else if (input.args[0] === "recording-inspect") {
              const value = object(parseJson(yield* fs.readFileString(input.args[1]!)));
              expect(value.source).toBe(clip.source);
              expect(value.source_sha256).toBe(clip.source_sha256);
            } else if (input.args[0] === "recording-export") {
              const folder = input.args[2]!;
              yield* fs.makeDirectory(folder, { recursive: true });
              const file = yield* fs.open(path.join(folder, "clip.mp4"), { flag: "w" });
              yield* file.truncate(49 * 1024 * 1024);
              yield* fs.writeFileString(path.join(folder, "captions.srt"), "Hello Bara");
            }
            return {
              stdout,
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }).pipe(Effect.scoped, Effect.orDie),
      });
      yield* Effect.gen(function* () {
        const service = yield* Recordings.Recordings;
        const ready = yield* (yield* service.changes()).pipe(
          Stream.mapEffect(() => service.read(id)),
          Stream.filter((snapshot) => object(object(snapshot).selected ?? null).status === "ready"),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild({ startImmediately: true }),
        );
        yield* service.mutate({
          operation: "recording_transcribe",
          requestId: request,
          id,
          expectedRevision: 0,
          payload: { attachmentId },
          name: "My recording",
        });
        yield* Deferred.await(entered);
        yield* service.mutate({
          operation: "recording_transcribe",
          requestId: request,
          id,
          expectedRevision: 0,
          payload: { attachmentId },
        });
        expect(calls).toBe(1);
        yield* Deferred.succeed(complete, undefined);
        yield* Fiber.join(ready);
        const snapshot = object(yield* service.read(id)),
          selected = object(snapshot.selected ?? null);
        expect(object(selected.clip ?? null).source).toBeUndefined();
        const revision = selected.revision as number;
        const stale = yield* service
          .mutate({
            operation: "recording_edit",
            id,
            requestId: edited,
            expectedRevision: revision - 1,
            payload: { cues: [] },
          })
          .pipe(Effect.flip);
        expect(stale.message).toContain("changed elsewhere");
        yield* service.mutate({
          operation: "recording_edit",
          id,
          requestId: edited,
          expectedRevision: revision,
          payload: {
            source: "/private/secret",
            cues: [{ start_ms: 0, end_ms: 1000, text: "Corrected" }],
          },
        });
        yield* service.mutate({
          operation: "recording_archive",
          id,
          requestId: request,
          expectedRevision: revision + 1,
          payload: {},
        });
      }).pipe(Effect.provide(Recordings.layer.pipe(Layer.provide(runner))));
      yield* Effect.gen(function* () {
        const studio = yield* Studio.Studio;
        const selected = object(
          object((yield* studio.read({ scope: "recordings", id })).data).selected ?? null,
        );
        expect(selected.archived).toBe(true);
        expect(object((object(selected.clip ?? null).cues as Schema.Json[])[0]!).text).toBe(
          "Corrected",
        );
        const revision = selected.revision as number;
        yield* studio.mutate({
          operation: "recording_restore",
          id,
          requestId: edited,
          expectedRevision: revision,
          payload: {},
        });
        const result = yield* studio.exportFile({
          kind: "recording",
          id,
          expectedRevision: revision + 1,
          delivery: "stream",
        });
        expect(result.files).toEqual([]);
        expect(result.downloads?.find((file) => file.name === "clip.mp4")?.bytes).toBe(
          49 * 1024 * 1024,
        );
        const legacy = yield* studio
          .exportFile({ kind: "recording", id, expectedRevision: revision + 1, delivery: "base64" })
          .pipe(Effect.flip);
        expect(isStudioError(legacy)).toBe(true);
        expect(legacy.message).toContain("too large");
        expect(
          yield* fs.readFileString(
            path.join(config.stateDir, "bara-studio", "recordings", id, "source.mp4"),
          ),
        ).toBe("original fixture");
      }).pipe(Effect.provide(Studio.layer.pipe(Layer.provide(runner))));
    }).pipe(
      Effect.scoped,
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.provideService(HostProcess.Environment, { BARA_STUDIO_FFMPEG: "/usr/bin/ffmpeg" }),
      Effect.provide(
        ServerConfig.layerTest("/", { prefix: "bara-recordings-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
);
