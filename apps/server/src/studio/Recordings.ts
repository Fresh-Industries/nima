import {
  StudioError,
  StudioId,
  type StudioMutationInput,
  type StudioExportInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import { ServerConfig } from "../config.ts";
import { parseAttachmentFileExtension, resolveAttachmentPathById } from "../attachmentStore.ts";
import { makeStudioEngine, studioFailure } from "./engine.ts";

const Cue = Schema.Struct({
  start_ms: Schema.Number,
  end_ms: Schema.Number,
  text: Schema.String.check(Schema.isMaxLength(4000)),
});
const Clip = Schema.Struct({
  format: Schema.Literal(1),
  source: Schema.String,
  source_sha256: Schema.String,
  source_bytes: Schema.Number,
  duration_ms: Schema.Number,
  cues: Schema.Array(Cue).check(Schema.isMaxLength(10000)),
  in_ms: Schema.Number,
  out_ms: Schema.Number,
});
const Meta = Schema.Struct({
  id: StudioId,
  name: Schema.String,
  revision: Schema.Int,
  archived: Schema.Boolean,
  status: Schema.Literals(["queued", "transcribing", "ready", "failed", "cancelled"]),
  operationId: StudioId,
  sourceFile: Schema.String.check(Schema.isPattern(/^source\.(mp4|webm|mov|mkv)$/)),
  head: Schema.NullOr(StudioId),
  durationMs: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  error: Schema.NullOr(Schema.String),
});
type Meta = typeof Meta.Type;
const decodeMeta = Schema.decodeUnknownEffect(Schema.fromJsonString(Meta)),
  encodeMeta = Schema.encodeEffect(Schema.fromJsonString(Meta));
const decodeClip = Schema.decodeUnknownEffect(Clip),
  decodeClipFile = Schema.decodeUnknownEffect(Schema.fromJsonString(Clip)),
  encodeClip = Schema.encodeEffect(Schema.fromJsonString(Clip));
const isId = Schema.is(StudioId),
  decodeCues = Schema.decodeUnknownEffect(Clip.fields.cues),
  decodeMetaValue = Schema.decodeUnknownEffect(Meta);
const record = (value: Schema.Json): Record<string, Schema.Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Schema.Json>)
    : {};

export class Recordings extends Context.Service<
  Recordings,
  {
    readonly read: (id?: string) => Effect.Effect<Schema.Json, StudioError>;
    readonly mutate: (input: StudioMutationInput) => Effect.Effect<Schema.Json, StudioError>;
    readonly exportFile: (
      input: StudioExportInput,
      output: string,
      encoder: string,
    ) => Effect.Effect<void, StudioError>;
    readonly changes: () => Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  }
>()("t3/studio/Recordings") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig,
    fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path,
    environment = yield* HostProcess.Environment,
    platform = yield* HostProcess.Platform;
  const { run } = yield* makeStudioEngine;
  const scope = yield* Effect.scope;
  const root = path.join(config.stateDir, "bara-studio", "recordings");
  const changes = yield* PubSub.sliding<void>(1),
    lock = yield* Semaphore.make(1),
    workers = yield* Semaphore.make(1);
  const directory = (id: string) => {
    if (!isId(id)) throw new StudioError({ detail: "Choose a saved recording." });
    return path.join(root, id);
  };
  const metaFile = (id: string) => path.join(directory(id), "recording.json");
  const load = Effect.fn("Recordings.load")(function* (id: string) {
    return yield* decodeMeta(yield* fs.readFileString(metaFile(id)));
  });
  const save = Effect.fn("Recordings.save")(function* (meta: Meta) {
    const folder = directory(meta.id);
    yield* fs.makeDirectory(folder, { recursive: true });
    const stage = path.join(folder, `meta-${meta.revision}-${meta.operationId}.tmp`);
    yield* fs.writeFileString(stage, yield* encodeMeta(meta));
    yield* fs.rename(stage, metaFile(meta.id));
    yield* PubSub.publish(changes, undefined);
  });
  const clipFile = (meta: Meta) => {
    if (!meta.head)
      throw new StudioError({ detail: "This recording has no completed transcript." });
    return path.join(directory(meta.id), `edit-${meta.head}.json`);
  };
  const loadClip = Effect.fn("Recordings.loadClip")(function* (meta: Meta) {
    const file = clipFile(meta);
    if (Number((yield* fs.stat(file)).size) > 8 * 1024 * 1024)
      return yield* new StudioError({ detail: "This transcript exceeds the supported size." });
    return yield* decodeClipFile(yield* fs.readFileString(file));
  });
  const list = Effect.fn("Recordings.list")(function* () {
    if (!(yield* fs.exists(root))) return [];
    const items: Meta[] = [];
    for (const name of (yield* fs.readDirectory(root)).filter(isId).slice(0, 512)) {
      const result = yield* load(name).pipe(Effect.result);
      if (result._tag === "Success") items.push(result.success);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  const transcriber = Effect.fn("Recordings.transcriber")(function* () {
    const python =
      environment.BARA_STUDIO_TRANSCRIBE_PYTHON ??
      path.join(
        config.baseDir,
        "bin",
        "transcriber",
        platform === "win32" ? "python.exe" : "python",
      );
    const model =
      environment.BARA_STUDIO_TRANSCRIBE_MODEL ??
      path.join(config.baseDir, "models", "whisper-tiny");
    return {
      python,
      model,
      ready:
        path.isAbsolute(python) &&
        path.isAbsolute(model) &&
        (yield* fs.exists(python)) &&
        (yield* fs.exists(path.join(model, "model.bin"))),
    };
  });
  const changeState = Effect.fn("Recordings.changeState")(function* (
    id: string,
    operationId: string,
    patch: Partial<Meta>,
  ) {
    const current = yield* load(id);
    if (current.operationId !== operationId || current.status === "cancelled") return null;
    const next = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* save(next);
    return next;
  }, lock.withPermit);
  const transcribe = Effect.fn("Recordings.transcribe")(
    function* (id: string, operationId: string) {
      const current = yield* changeState(id, operationId, { status: "transcribing", error: null });
      if (!current) return;
      const settings = yield* transcriber();
      if (!settings.ready)
        return yield* new StudioError({
          detail: "Configure the local transcription interpreter and speech model on this host.",
        });
      const folder = directory(id),
        output = path.join(folder, `snapshots-${operationId}`),
        cancel = path.join(folder, `cancel-${operationId}`);
      const result = yield* run(
        [
          "recording-transcribe",
          path.join(folder, current.sourceFile),
          settings.python,
          settings.model,
          output,
          cancel,
        ],
        { timeout: "30 minutes" },
      ).pipe(Effect.onInterrupt(() => fs.writeFileString(cancel, "cancel").pipe(Effect.ignore)));
      const clip = yield* decodeClip(result);
      const file = path.join(folder, `edit-${operationId}.json`);
      yield* fs.writeFileString(file, yield* encodeClip(clip), { flag: "wx" });
      yield* changeState(id, operationId, {
        head: StudioId.make(operationId),
        status: "ready",
        durationMs: clip.duration_ms,
        error: null,
      });
    },
    workers.withPermit,
    (effect, id, operationId) =>
      effect.pipe(
        Effect.catch((error) =>
          changeState(id, operationId, {
            status: "failed",
            error: studioFailure(error).message,
          }).pipe(Effect.ignore),
        ),
      ),
  );
  const read = Effect.fn("Recordings.read")(function* (id?: string) {
    const settings = yield* transcriber(),
      items = yield* list();
    const selected = id ? items.find((item) => item.id === id) : undefined;
    const clip = selected?.head ? yield* loadClip(selected) : null;
    return {
      configured: settings.ready,
      message: settings.ready
        ? null
        : "Configure BARA_STUDIO_TRANSCRIBE_PYTHON and BARA_STUDIO_TRANSCRIBE_MODEL with an existing local interpreter and faster-whisper model on this Bara host. No media is sent to an external service.",
      recordings: items,
      selected: selected
        ? {
            ...selected,
            clip: clip
              ? {
                  duration_ms: clip.duration_ms,
                  in_ms: clip.in_ms,
                  out_ms: clip.out_ms,
                  cues: clip.cues,
                }
              : null,
          }
        : null,
    };
  }, Effect.mapError(studioFailure));
  const mutate = Effect.fn("Recordings.mutate")(
    function* (input: StudioMutationInput) {
      const payload = record(input.payload);
      const id = input.id ?? input.requestId;
      if (input.operation === "recording_transcribe") {
        const settings = yield* transcriber();
        if (!settings.ready)
          return yield* new StudioError({
            detail: "Connect the local transcription interpreter and model first.",
          });
        const existing = (yield* fs.exists(metaFile(id))) ? yield* load(id) : null;
        if (
          existing &&
          (existing.operationId === input.requestId ||
            existing.status === "queued" ||
            existing.status === "transcribing")
        )
          return { id, status: existing.status };
        if (existing && existing.revision !== input.expectedRevision)
          return yield* new StudioError({
            detail: "This recording changed elsewhere. Refresh before retrying.",
          });
        if (
          (yield* list()).filter(
            (item) => item.status === "queued" || item.status === "transcribing",
          ).length >= 8
        )
          return yield* new StudioError({
            detail:
              "Eight recordings are already queued. Wait for one to finish before adding more.",
          });
        const folder = directory(id);
        yield* fs.makeDirectory(folder, { recursive: true });
        let sourceFile = existing?.sourceFile;
        if (!existing) {
          if (typeof payload.attachmentId !== "string")
            return yield* new StudioError({ detail: "Upload a video recording first." });
          const source = resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: payload.attachmentId,
          });
          const extension = parseAttachmentFileExtension(payload.attachmentId);
          if (!source || !extension || !["mp4", "webm", "mov", "mkv"].includes(extension))
            return yield* new StudioError({ detail: "Upload an MP4, WebM, MOV or MKV recording." });
          if (Number((yield* fs.stat(source)).size) > 256 * 1024 * 1024)
            return yield* new StudioError({
              detail: "Recordings currently support uploads up to 256 MiB.",
            });
          sourceFile = `source.${extension}`;
          yield* fs.copyFile(source, path.join(folder, sourceFile));
        }
        const at = DateTime.formatIso(yield* DateTime.now);
        const meta = yield* decodeMetaValue({
          id,
          name: existing?.name ?? input.name ?? "Recording",
          revision: (existing?.revision ?? 0) + 1,
          archived: existing?.archived ?? false,
          status: "queued",
          operationId: input.requestId,
          sourceFile,
          head: existing?.head ?? null,
          durationMs: existing?.durationMs ?? 0,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at,
          error: null,
        });
        yield* save(meta);
        yield* transcribe(id, input.requestId).pipe(Effect.forkIn(scope));
        return { id, status: "queued" };
      }
      if (!input.id) return yield* new StudioError({ detail: "Choose a recording first." });
      const current = yield* load(input.id);
      if (
        input.operation === "recording_edit" &&
        current.operationId === input.requestId &&
        current.status === "ready"
      )
        return { id };
      if (current.revision !== input.expectedRevision)
        return yield* new StudioError({
          detail:
            "This recording changed elsewhere. Refresh and keep your unsaved edits before retrying.",
        });
      if (input.operation === "recording_archive" || input.operation === "recording_restore") {
        yield* save({
          ...current,
          archived: input.operation === "recording_archive",
          revision: current.revision + 1,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
        return { id };
      }
      if (input.operation === "recording_cancel") {
        if (current.status !== "queued" && current.status !== "transcribing") return { id };
        yield* fs.writeFileString(
          path.join(directory(id), `cancel-${current.operationId}`),
          "cancel",
        );
        yield* save({
          ...current,
          status: "cancelled",
          revision: current.revision + 1,
          error: null,
          updatedAt: DateTime.formatIso(yield* DateTime.now),
        });
        return { id };
      }
      if (input.operation !== "recording_edit" || current.status !== "ready")
        return yield* new StudioError({
          detail: "Wait for a completed recording before editing its transcript.",
        });
      const clip = yield* loadClip(current),
        cues = yield* decodeCues(payload.cues ?? clip.cues);
      const next = {
        ...clip,
        cues,
        in_ms: typeof payload.in_ms === "number" ? payload.in_ms : clip.in_ms,
        out_ms: typeof payload.out_ms === "number" ? payload.out_ms : clip.out_ms,
      };
      const file = path.join(directory(id), `edit-${input.requestId}.json`);
      yield* fs.writeFileString(file, yield* encodeClip(next), { flag: "wx" });
      yield* run(["recording-inspect", file]).pipe(
        Effect.onError(() => fs.remove(file).pipe(Effect.ignore)),
      );
      yield* save({
        ...current,
        operationId: input.requestId,
        head: input.requestId,
        revision: current.revision + 1,
        updatedAt: DateTime.formatIso(yield* DateTime.now),
      });
      return { id };
    },
    lock.withPermit,
    Effect.mapError(studioFailure),
  );
  const exportFile = Effect.fn("Recordings.exportFile")(function* (
    input: StudioExportInput,
    output: string,
    encoder: string,
  ) {
    if (!input.id) return yield* new StudioError({ detail: "Choose a recording first." });
    const meta = yield* load(input.id);
    if (meta.revision !== input.expectedRevision || !meta.head)
      return yield* new StudioError({ detail: "The recording changed. Refresh before exporting." });
    yield* run(["recording-export", clipFile(meta), output, encoder], { json: false });
  }, Effect.mapError(studioFailure));
  for (const meta of yield* list())
    if (meta.status === "queued" || meta.status === "transcribing")
      yield* save({
        ...meta,
        status: "failed",
        revision: meta.revision + 1,
        error:
          "The backend restarted before transcription completed. The original recording is preserved; retry when ready.",
      });
  return Recordings.of({
    read,
    mutate,
    exportFile,
    changes: Effect.fn("Recordings.changes")(() =>
      Effect.map(PubSub.subscribe(changes), Stream.fromSubscription),
    ),
  });
});
export const layer = Layer.effect(Recordings, make);
