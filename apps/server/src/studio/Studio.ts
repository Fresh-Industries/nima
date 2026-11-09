// @effect-diagnostics nodeBuiltinImport:off -- Stable IDs are calculated synchronously for the external CLI protocol.
import * as NodeCrypto from "node:crypto";
import {
  StudioError,
  type StudioReadInput,
  type StudioSnapshot,
  type StudioMutationInput,
  type StudioExportInput,
  type StudioExportResult,
} from "@t3tools/contracts";
import * as Recordings from "./Recordings.ts";
import { makeStudioEngine, studioFailure } from "./engine.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import {
  resolveAttachmentPathById,
  createPendingAttachmentId,
  attachmentFileExtension,
} from "../attachmentStore.ts";

type Json = Schema.Json;
const jsonCodec = Schema.fromJsonString(Schema.Json);
const encodeJson = Schema.encodeSync(jsonCodec);
function object(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}
function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}
function derivedId(id: string, kind: string) {
  const bytes = NodeCrypto.createHash("sha256")
    .update(id + ":" + kind)
    .digest();
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function validateStudioPayload(value: Json): void {
  if (encodeJson(value).length > 12 * 1024 * 1024)
    throw new Error("Studio edits are limited to 12 MiB.");
  const visit = (item: Json): void => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (
        ["path", "source", "encoder", "destination", "root"].includes(key) &&
        typeof child === "string"
      )
        throw new Error("Studio resources must belong to this workspace. Import the file first.");
      visit(child);
    }
  };
  visit(value);
}

export class Studio extends Context.Service<
  Studio,
  {
    readonly read: (input: StudioReadInput) => Effect.Effect<StudioSnapshot, StudioError>;
    readonly mutate: (input: StudioMutationInput) => Effect.Effect<Json, StudioError>;
    readonly exportFile: (
      input: StudioExportInput,
    ) => Effect.Effect<StudioExportResult, StudioError>;
    readonly subscribe: (input: StudioReadInput) => Stream.Stream<StudioSnapshot, StudioError>;
  }
>()("t3/studio/Studio") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.join(config.stateDir, "bara-studio");
  const liveRoot = path.join(root, "live", "studio");
  const { run, resolveEncoder } = yield* makeStudioEngine;
  const recordings = yield* Recordings.Recordings;
  const changes = yield* PubSub.sliding<void>(1);
  const lock = yield* Semaphore.make(1);
  const error = studioFailure;
  const hasStudio = Effect.fn("Studio.hasStudio")(function* () {
    if (!(yield* fs.exists(root))) return false;
    return (yield* fs.readDirectory(root)).some((name) => name.endsWith(".studio.json"));
  });
  const withJson = <A, E, R>(value: Json, use: (file: string) => Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const temp = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "request-" });
        const file = path.join(temp, "request.json");
        yield* fs.writeFileString(file, encodeJson(value));
        return yield* use(file);
      }),
    );
  const studioData = Effect.fn("Studio.catalog")(function* () {
    return object(yield* run(["studio-inspect", root]));
  });
  const artworkPath = Effect.fn("Studio.artworkPath")(function* (id: string) {
    const value = object(yield* run(["studio-document-path", root, id]));
    if (typeof value.path !== "string")
      return yield* new StudioError({ detail: "This document is not an artwork canvas." });
    const actual = yield* fs.realPath(value.path);
    const owned = yield* fs.realPath(root);
    if (!actual.startsWith(owned + path.sep))
      return yield* new StudioError({ detail: "This canvas is outside the managed Studio." });
    return actual;
  });
  const applyStudio = Effect.fn("Studio.applyCatalog")(function* (request: Json) {
    return yield* withJson(request, (file) => run(["studio-apply", root, file]));
  });
  const seed = Effect.fn("Studio.seed")(function* () {
    const existed = yield* hasStudio();
    if (!existed) yield* run(["studio-init", root]);
    const current = yield* studioData();
    if (list(object(current.studio ?? null).projects).length) return false;
    const project = derivedId("bara-workspace", "project");
    const workspaces = ["design", "photo", "story", "motion", "live"].map((kind) => ({
      op: "add_workspace",
      workspace: { id: derivedId(project, kind), project, kind },
    }));
    yield* applyStudio({
      request_id: derivedId(project, "initialize"),
      expected_revision: current.revision ?? 0,
      action: {
        type: "edit",
        commands: [
          {
            op: "add_project",
            project: { id: project, name: "Studio", pinned: false, starred: false },
          },
          ...workspaces,
        ],
      },
    });
    return true;
  });
  const svgFor = Effect.fn("Studio.svg")(function* (folder: string) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped({ directory: root, prefix: "preview-" });
        const output = path.join(dir, "canvas.svg");
        yield* run(["export", folder, output]);
        return yield* fs.readFileString(output);
      }),
    );
  });
  const read = Effect.fn("Studio.read")(function* (input: StudioReadInput) {
    const ready = yield* run(["capabilities"]).pipe(Effect.result);
    if (ready._tag === "Failure")
      return {
        available: false,
        message:
          "Studio is not available on this environment. Install the Bara desktop build with Studio included, or connect to a Studio-enabled server.",
        data: null,
        svg: null,
      };
    if (input.scope === "capabilities")
      return { available: true, message: null, data: ready.success, svg: null };
    if (input.scope === "recordings")
      return { available: true, message: null, data: yield* recordings.read(input.id), svg: null };
    if (!(yield* hasStudio())) return { available: true, message: null, data: null, svg: null };
    if (input.scope === "artwork" && input.id) {
      const folder = yield* artworkPath(input.id);
      return {
        available: true,
        message: null,
        data: yield* run(["inspect", folder]),
        svg: yield* svgFor(folder),
      };
    }
    if (input.scope === "live") {
      if (!(yield* fs.exists(liveRoot)))
        return { available: true, message: null, data: null, svg: null };
      return {
        available: true,
        message: null,
        data: yield* run(["live-inspect", liveRoot]),
        svg: null,
      };
    }
    return { available: true, message: null, data: yield* studioData(), svg: null };
  }, Effect.mapError(error));

  const mutate = Effect.fn("Studio.mutate")(
    function* (input: StudioMutationInput) {
      yield* Effect.try(() => validateStudioPayload(input.payload));
      if (input.operation.startsWith("recording_")) return yield* recordings.mutate(input);
      const created = yield* seed();
      if (input.operation === "photo_crop" && input.id) {
        const folder = yield* artworkPath(input.id);
        const current = object(yield* run(["inspect", folder]));
        if (current.revision !== input.expectedRevision)
          return yield* new StudioError({ detail: "The photo changed. Refresh before cropping." });
        const payload = object(input.payload);
        const imageId = payload.imageId;
        if (typeof imageId !== "string" || !/^[0-9a-f-]{36}$/i.test(imageId))
          return yield* new StudioError({ detail: "Select an image layer first." });
        const planned =
          payload.region === null
            ? yield* run(["photo-crop-plan", folder, imageId, "reset"])
            : yield* withJson(payload.region ?? null, (file) =>
                run(["photo-crop-plan", folder, imageId, file]),
              );
        const request = {
          ...object(planned),
          request_id: input.requestId,
          expected_revision: input.expectedRevision,
        };
        const result = yield* withJson(request, (file) => run(["apply", folder, file]));
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      if (input.operation === "artwork") {
        if (!input.id) return yield* new StudioError({ detail: "Choose a canvas first." });
        const folder = yield* artworkPath(input.id);
        const result = yield* withJson(
          {
            request_id: input.requestId,
            expected_revision: input.expectedRevision,
            action: input.payload,
          },
          (file) => run(["apply", folder, file]),
        );
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      if (input.operation === "live") {
        if (object(input.payload).op === "capture")
          return yield* new StudioError({
            detail: "Connect devices explicitly in the browser's Live workspace.",
          });
        if (!(yield* fs.exists(liveRoot)))
          return yield* new StudioError({ detail: "Create the Live collection first." });
        const result = yield* withJson(input.payload, (file) =>
          run(["live-apply", liveRoot, String(input.expectedRevision), file]),
        );
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      if (input.operation === "pin") {
        if (!input.id) return yield* new StudioError({ detail: "Choose artwork to pin." });
        const folder = yield* artworkPath(input.id);
        const inspection = object(yield* run(["inspect", folder]));
        const svg = yield* svgFor(folder);
        const box = svg
          .match(/viewBox="([^"]+)"/)?.[1]
          ?.trim()
          .split(/\s+/)
          .map(Number);
        const reference = yield* run(["studio-pin-artwork", root, input.id]);
        if (object(reference).snapshot !== inspection.head)
          return yield* new StudioError({
            detail: "The artwork changed while it was being pinned. Refresh and try again.",
          });
        const document = object(inspection.document ?? null);
        const roots = (Array.isArray(document.nodes) ? document.nodes : [])
          .map(object)
          .filter((node) => node.parent === null && node.visible !== false);
        return {
          reference,
          width: box?.[2] ?? 1280,
          height: box?.[3] ?? 720,
          origin: [box?.[0] ?? 0, box?.[1] ?? 0],
          layers: roots.slice(0, 33).map((node) => ({
            id: node.id ?? null,
            name: node.name ?? "Layer",
            bounds: node.bounds ?? null,
          })),
        };
      }
      const current = yield* studioData();
      const revision = typeof current.revision === "number" ? current.revision : 0;
      if (revision !== input.expectedRevision && !(created && input.expectedRevision === 0))
        return yield* new StudioError({
          detail: "Studio changed in another session. Refresh before applying this edit.",
        });
      if (input.operation === "studio") {
        const result = yield* applyStudio({
          request_id: input.requestId,
          expected_revision: revision,
          action: input.payload,
        });
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      const state = object(current.studio ?? null);
      if (input.operation === "import_audio" && input.id) {
        const payload = object(input.payload);
        const target = list(state.assets)
          .map(object)
          .find((asset) => asset.id === input.id);
        const sequence = object(object(target?.content ?? null).sequence ?? null);
        const frames = list(sequence.shots)
          .map(object)
          .reduce((sum, shot) => sum + (typeof shot.frames === "number" ? shot.frames : 0), 0);
        if (frames < 1)
          return yield* new StudioError({ detail: "Add a shot before importing audio." });
        const attachmentId = payload.attachmentId;
        if (typeof attachmentId !== "string")
          return yield* new StudioError({ detail: "Upload the audio file first." });
        const uploaded = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId,
        });
        if (!uploaded)
          return yield* new StudioError({ detail: "The uploaded audio file is unavailable." });
        const actual = yield* fs.realPath(uploaded);
        const owned = yield* fs.realPath(config.attachmentsDir);
        if (!actual.startsWith(owned + path.sep))
          return yield* new StudioError({ detail: "The audio file must be a workspace upload." });
        const name = typeof payload.name === "string" ? payload.name.slice(0, 200) : "Audio";
        const audioId = derivedId(input.requestId, "audio");
        const plan = yield* run([
          "studio-audio-prepare",
          root,
          actual,
          audioId,
          name,
          input.requestId,
          String(revision),
        ]);
        const imported = object(
          yield* withJson(plan, (file) => run(["studio-audio-import", root, file])),
        );
        const media = object(object(plan).media ?? null);
        const anchor =
          typeof payload.frame === "number"
            ? Math.max(0, Math.min(Math.floor(payload.frame), frames - 1))
            : 0;
        const rate = typeof media.sample_rate === "number" ? media.sample_rate : 48000;
        const end = Math.min(
          typeof media.frames === "number" ? media.frames : 0,
          Math.floor(((frames - anchor) * rate) / 24),
        );
        const clip = {
          id: derivedId(input.requestId, "audio-clip"),
          name,
          original: audioId,
          hash: media.hash ?? "",
          in_sample: 0,
          out_sample: end,
          anchor: { type: "sequence", frame: anchor },
          lane: payload.lane === "voice" ? "voice" : "music",
          volume: 1,
          fade_in_frames: 0,
          fade_out_frames: 0,
          muted: false,
        };
        const nextRevision =
          typeof imported.revision === "number" ? imported.revision : revision + 1;
        const result = yield* applyStudio({
          request_id: derivedId(input.requestId, "place-audio"),
          expected_revision: nextRevision,
          action: {
            type: "edit",
            commands: [
              { op: "edit_motion_sequence", id: input.id, commands: [{ op: "add_audio", clip }] },
            ],
          },
        });
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      const workspace = list(state.workspaces)
        .map(object)
        .find((w) => w.kind === (input.operation === "motion_from_story" ? "motion" : input.area));
      if (!workspace || typeof workspace.id !== "string")
        return yield* new StudioError({ detail: "This workspace is unavailable." });
      if (input.operation === "motion_from_story") {
        const plan = {
          ...object(input.payload),
          request_id: input.requestId,
          expected_revision: revision,
          workspace: workspace.id,
        };
        const request = yield* withJson(plan, (file) => run(["studio-motion-plan", root, file]));
        const result = yield* applyStudio(request);
        yield* PubSub.publish(changes, undefined);
        return result;
      }
      if (input.area === "live") {
        yield* fs.makeDirectory(path.dirname(liveRoot), { recursive: true });
        if (!(yield* fs.exists(liveRoot))) yield* run(["live-demo", liveRoot]);
        yield* PubSub.publish(changes, undefined);
        return { id: "live" };
      }
      const id = input.id ?? input.requestId;
      const name =
        input.name?.trim() || (input.area === "story" ? "Untitled story" : "Untitled canvas");
      if (input.area === "story") {
        const story = {
          id: derivedId(id, "story"),
          premise: "",
          world: "",
          characters: [],
          scenes: [],
        };
        yield* applyStudio({
          request_id: input.requestId,
          expected_revision: revision,
          action: {
            type: "edit",
            commands: [
              {
                op: "add_asset",
                asset: { id, name, starred: false, content: { type: "story", story } },
              },
              {
                op: "add_card",
                card: {
                  id: derivedId(id, "card"),
                  asset: id,
                  project: workspace.project ?? null,
                  folder: null,
                  bounds: { x: 0, y: 0, w: 300, h: 220 },
                },
              },
              {
                op: "add_workspace_item",
                item: { id: derivedId(id, "item"), workspace: workspace.id, asset: id },
              },
            ],
          },
        });
      } else {
        const candidatePreset = object(input.payload).preset;
        const preset =
          typeof candidatePreset === "string"
            ? candidatePreset
            : input.area === "photo"
              ? "photo"
              : "poster";
        const plan = {
          request_id: input.requestId,
          expected_revision: revision,
          document: id,
          asset: id,
          card: derivedId(id, "card"),
          name,
          project: workspace.project ?? null,
          folder: null,
          bounds: { x: 0, y: 0, w: 300, h: 220 },
          workspace: { workspace: workspace.id, item: derivedId(id, "item"), preset },
        };
        yield* withJson(plan, (file) => run(["studio-create-canvas", root, file]));
      }
      yield* PubSub.publish(changes, undefined);
      return { id };
    },
    lock.withPermit,
    Effect.mapError(error),
  );

  const exportFile = Effect.fn("Studio.exportFile")(function* (input: StudioExportInput) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        if (input.kind !== "recording" && !(yield* hasStudio()))
          return yield* new StudioError({ detail: "Create a Studio document first." });
        const dir = yield* fs.makeTempDirectoryScoped({
          directory: config.stateDir,
          prefix: "studio-export-",
        });
        let output = path.join(dir, "artwork.svg");
        if (["svg", "png", "outlined_svg"].includes(input.kind)) {
          if (!input.id) return yield* new StudioError({ detail: "Choose artwork to export." });
          const folder = yield* artworkPath(input.id);
          const current = object(yield* run(["inspect", folder]));
          if (current.revision !== input.expectedRevision)
            return yield* new StudioError({
              detail: "The document changed. Refresh before exporting.",
            });
          output = path.join(dir, input.kind === "png" ? "artwork.png" : "artwork.svg");
          const args =
            input.kind === "png"
              ? ["export-png", folder, output, "1"]
              : [input.kind === "outlined_svg" ? "export-outlined-svg" : "export", folder, output];
          if (input.layerId && input.kind !== "svg") args.push(input.layerId);
          yield* run(args);
        } else if (input.kind === "story" && input.id) {
          output = path.join(dir, "story");
          yield* run([
            "studio-export-story",
            root,
            input.id,
            String(input.expectedRevision),
            output,
          ]);
        } else if (input.kind === "motion" && input.id) {
          const encoder = yield* resolveEncoder();
          output = path.join(dir, "movie.mp4");
          yield* withJson(
            {
              asset: input.id,
              expected_revision: input.expectedRevision,
              destination: output,
              preset: "hd720",
              encoder,
            },
            (file) => run(["studio-export-video", root, file]),
          );
        } else if (input.kind === "motion_frame" && input.id) {
          output = path.join(dir, "frame.png");
          yield* run([
            "studio-motion-frame",
            root,
            input.id,
            String(input.expectedRevision),
            String(input.frame ?? 0),
            output,
            "960",
          ]);
        } else if (input.kind === "recording") {
          output = path.join(dir, "recording");
          yield* recordings.exportFile(input, output, yield* resolveEncoder());
        } else if (input.kind === "live") {
          const encoder = yield* resolveEncoder();
          const current = object(yield* run(["live-inspect", liveRoot]));
          if (current.revision !== input.expectedRevision)
            return yield* new StudioError({
              detail: "The Live scene changed. Refresh before exporting.",
            });
          output = path.join(dir, "live");
          yield* run(["live-export", liveRoot, encoder, String(input.frame ?? 150), output]);
        } else return yield* new StudioError({ detail: "Unsupported export." });
        const files: StudioExportResult["files"][number][] = [];
        const downloads: NonNullable<StudioExportResult["downloads"]>[number][] = [];
        let bytes = 0;
        const collect = Effect.fn("Studio.collectExport")(function* (
          file: string,
          prefix: string,
        ): Effect.fn.Return<void, StudioError | PlatformError.PlatformError> {
          const stat = yield* fs.stat(file);
          if (stat.type === "Directory") {
            for (const name of yield* fs.readDirectory(file))
              yield* collect(path.join(file, name), prefix ? `${prefix}/${name}` : name);
          } else if (stat.type === "File") {
            bytes += Number(stat.size);
            if (
              bytes > (input.delivery === "stream" ? 2 * 1024 * 1024 * 1024 : 48 * 1024 * 1024) ||
              files.length + downloads.length >= 1024
            )
              return yield* new StudioError({
                detail:
                  "This export is too large to download through the workspace. Export a shorter sequence.",
              });
            const ext = path.extname(file);
            const mime: Record<string, string> = {
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".mp4": "video/mp4",
              ".html": "text/html",
              ".md": "text/markdown",
              ".json": "application/json",
              ".srt": "application/x-subrip",
            };
            if (input.delivery === "stream") {
              const extension = attachmentFileExtension(file);
              const attachmentId = createPendingAttachmentId(extension);
              yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
              yield* fs.copyFile(
                file,
                path.join(config.attachmentsDir, `${attachmentId}${extension}`),
              );
              downloads.push({
                name: prefix || path.basename(file),
                mimeType: mime[ext] ?? "application/octet-stream",
                attachmentId,
                bytes: Number(stat.size),
              });
              return;
            }
            const data = yield* fs.readFile(file);
            files.push({
              name: prefix || path.basename(file),
              mimeType: mime[ext] ?? "application/octet-stream",
              base64: Buffer.from(data).toString("base64"),
            });
          }
        });
        yield* collect(output, "");
        return { files, downloads };
      }),
    );
  }, Effect.mapError(error));
  return Studio.of({
    read,
    mutate,
    exportFile,
    subscribe: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const recordingChanges = yield* recordings.changes();
          return Stream.concat(
            Stream.fromEffect(read(input)),
            Stream.merge(Stream.fromSubscription(subscription), recordingChanges).pipe(
              Stream.mapEffect(() => read(input)),
            ),
          );
        }),
      ),
  });
});
export const layer = Layer.effect(Studio, make).pipe(Layer.provide(Recordings.layer));
