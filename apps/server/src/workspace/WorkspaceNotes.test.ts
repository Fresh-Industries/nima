import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { WORKSPACE_NOTE_MAX_LENGTH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Notes from "./WorkspaceNotes.ts";

const memory = Notes.layer.pipe(Layer.provide(Sqlite.layerMemory));

it.effect("rejects competing edits and safely retries a save whose reply was lost", () =>
  Effect.gen(function* () {
    const notes = yield* Notes.WorkspaceNotes;
    const results = yield* Effect.all(
      [
        notes.write({ expectedRevision: 0, markdown: "# First browser\n\n- [ ] Write" }),
        notes.write({ expectedRevision: 0, markdown: "# Second browser" }),
      ],
      { concurrency: "unbounded" },
    );
    assert.deepEqual(results.map((result) => result.status).sort(), ["conflict", "saved"]);
    const saved = results.find((result) => result.status === "saved")!;
    assert.equal(saved.note.revision, 1);
    assert.deepEqual(yield* notes.read(), saved.note);
    assert.deepEqual(
      yield* notes.write({ expectedRevision: 0, markdown: saved.note.markdown }),
      saved,
    );
    const changed = yield* notes.write({ expectedRevision: 1, markdown: "**Resolved**" });
    assert.equal(changed.status, "saved");
    assert.equal(changed.note.revision, 2);
    assert.deepEqual(yield* notes.write({ expectedRevision: 0, markdown: "stale" }), {
      status: "conflict",
      note: changed.note,
    });
  }).pipe(Effect.provide(memory)),
);

it.effect(
  "streams an initial snapshot and committed changes without losing a concurrent save",
  () =>
    Effect.gen(function* () {
      const notes = yield* Notes.WorkspaceNotes;
      const snapshots = yield* Queue.unbounded<import("@t3tools/contracts").WorkspaceNote>();
      const stream = yield* notes.subscribe().pipe(
        Stream.runForEach((note) => Queue.offer(snapshots, note)),
        Effect.forkChild,
      );
      assert.equal((yield* Queue.take(snapshots)).revision, 0);
      const result = yield* notes.write({
        expectedRevision: 0,
        markdown: "# Live\n\n```ts\nconst ok = true;\n```",
      });
      assert.deepEqual(yield* Queue.take(snapshots), result.note);
      yield* Fiber.interrupt(stream);
    }).pipe(Effect.provide(memory)),
);

it.effect("rejects invalid writes without changing the durable note", () =>
  Effect.gen(function* () {
    const notes = yield* Notes.WorkspaceNotes;
    for (const input of [
      { expectedRevision: -1, markdown: "invalid revision" },
      { expectedRevision: 0, markdown: "x".repeat(WORKSPACE_NOTE_MAX_LENGTH + 1) },
    ])
      assert.isTrue(Exit.isFailure(yield* notes.write(input).pipe(Effect.exit)));
    assert.deepEqual(yield* notes.read(), { markdown: "", revision: 0, updatedAt: null });
  }).pipe(Effect.provide(memory)),
);

it.effect("retains exact Markdown after closing and reopening the database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-notes-" });
    const database = () =>
      Notes.layer.pipe(Layer.provide(Sqlite.layerFromPath(`${dir}/notes.sqlite`)));
    const markdown =
      "# Notes 🍊\n\n**Bold**, _italic_, [link](https://example.org).\n\n- [x] Keep this\n\n```js\nconst value = '<script>';\n```\n";
    const saved = yield* Effect.gen(function* () {
      return yield* (yield* Notes.WorkspaceNotes).write({ markdown, expectedRevision: 0 });
    }).pipe(Effect.provide(database()));
    const reopened = yield* Effect.gen(function* () {
      return yield* (yield* Notes.WorkspaceNotes).read();
    }).pipe(Effect.provide(database()));
    assert.deepEqual(reopened, saved.note);
    assert.equal(reopened.markdown, markdown);
  }).pipe(Effect.provide(NodeServices.layer)),
);
