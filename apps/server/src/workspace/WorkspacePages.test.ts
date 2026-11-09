import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  RunId,
  ThreadId,
  WORKSPACE_NOTE_MAX_LENGTH,
  type WorkspacePageContent,
  type WorkspacePagesSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Pages from "./WorkspacePages.ts";

const memory = Pages.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
const content: WorkspacePageContent = {
  title: "Research",
  markdown: "# Research\n\n**Keep this.**",
  archived: false,
  source: null,
};

it.effect(
  "isolates pages, rejects competing edits, and retries committed writes without overwriting newer content",
  () =>
    Effect.gen(function* () {
      const pages = yield* Pages.WorkspacePages;
      const results = yield* Effect.all(
        [
          pages.write({ id: "research", content, expectedRevision: 0 }),
          pages.write({
            id: "research",
            content: { ...content, title: "Competing title" },
            expectedRevision: 0,
          }),
          pages.write({ id: "plan", content: { ...content, title: "Plan" }, expectedRevision: 0 }),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(
        results
          .slice(0, 2)
          .map((result) => result.status)
          .sort(),
        ["conflict", "saved"],
      );
      const first = results.find((result) => result.status === "saved")!.page!;
      assert.deepEqual(
        yield* pages.write({ id: "research", content: first.content, expectedRevision: 0 }),
        { status: "saved", page: first },
      );
      const changed = yield* pages.write({
        id: "research",
        content: { ...first.content, markdown: "# Updated" },
        expectedRevision: 1,
      });
      assert.equal(changed.page?.revision, 2);
      assert.deepEqual(
        yield* pages.write({ id: "research", content: first.content, expectedRevision: 1 }),
        { status: "conflict", page: changed.page },
      );
      assert.equal((yield* pages.read({ id: "plan" }))?.content.title, "Plan");
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "searches full Markdown literally and archives/restores without deleting source attribution",
  () =>
    Effect.gen(function* () {
      const pages = yield* Pages.WorkspacePages;
      const source = { threadId: ThreadId.make("work"), runId: RunId.make("result") };
      const original = yield* pages.write({
        id: "research",
        content: { ...content, source, markdown: `${"intro ".repeat(100)}Needle %_Literal` },
        expectedRevision: 0,
      });
      assert.equal((yield* pages.list({ query: "%_literal" })).pages[0]?.id, "research");
      assert.equal((yield* pages.list({ query: "unrelated" })).pages.length, 0);
      const archived = yield* pages.write({
        id: "research",
        content: { ...original.page!.content, archived: true },
        expectedRevision: 1,
      });
      assert.equal((yield* pages.list({})).pages.length, 0);
      assert.deepEqual((yield* pages.list({ archived: true })).pages[0]?.source, source);
      yield* pages.write({
        id: "research",
        content: { ...archived.page!.content, archived: false },
        expectedRevision: 2,
      });
      assert.equal((yield* pages.list({})).pages[0]?.revision, 3);
      assert.equal(
        (yield* pages.read({ id: "research" }))?.content.markdown,
        original.page?.content.markdown,
      );
      for (const invalid of [
        { ...content, title: " " },
        { ...content, markdown: "x".repeat(WORKSPACE_NOTE_MAX_LENGTH + 1) },
      ])
        assert.isTrue(
          Exit.isFailure(
            yield* pages
              .write({ id: "invalid", content: invalid, expectedRevision: 0 })
              .pipe(Effect.exit),
          ),
        );
      assert.isNull(yield* pages.read({ id: "invalid" }));
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "streams committed pages while summaries omit bodies and pagination retains tied timestamps",
  () =>
    Effect.gen(function* () {
      const pages = yield* Pages.WorkspacePages;
      const snapshots = yield* Queue.unbounded<WorkspacePagesSnapshot>();
      const reader = yield* pages.subscribe({ id: "first" }).pipe(
        Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
        Effect.forkChild,
      );
      assert.isNull((yield* Queue.take(snapshots)).page);
      const saved = yield* pages.write({ id: "first", content, expectedRevision: 0 });
      const received = yield* Queue.take(snapshots);
      assert.deepEqual(received.page, saved.page);
      assert.isFalse("markdown" in received.pages[0]!);
      yield* Fiber.interrupt(reader);
      for (let index = 0; index < 52; index++)
        yield* pages.write({ id: `page-${index}`, content, expectedRevision: 0 });
      const first = yield* pages.list({});
      const second = yield* pages.list({ before: first.nextCursor! });
      assert.equal(first.pages.length, 50);
      assert.equal(second.pages.length, 3);
      assert.equal(new Set([...first.pages, ...second.pages].map((page) => page.id)).size, 53);
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "captures the full persisted result and keeps edits intact when a capture reply is retried",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const pages = yield* Pages.WorkspacePages;
      const at = "2026-11-04T12:00:00.000Z";
      const markdown = `# Full result\n\n${"Details beyond the Inbox preview.\n".repeat(200)}`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
    VALUES ('work', 'project', 'Work result', 'devReplay', 'full-access', 'default', ${at}, ${at}, '{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
    VALUES ('run', 'work', 1, 'devReplay', 'completed', ${at}, ${at}, '{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
    VALUES ('reply', 'work', 'run', 'assistant', 0, ${at}, ${at}, ${JSON.stringify({ text: markdown })})`;
      const input = { id: "captured", threadId: ThreadId.make("work"), runId: RunId.make("run") };
      const saved = yield* pages.capture(input);
      assert.equal(saved.page?.content.markdown, markdown);
      assert.deepEqual(saved.page?.content.source, { threadId: "work", runId: "run" });
      const edited = yield* pages.write({
        id: input.id,
        content: { ...saved.page!.content, markdown: "My edited draft" },
        expectedRevision: 1,
      });
      assert.deepEqual((yield* pages.capture(input)).page, edited.page);
      assert.isTrue(
        Exit.isFailure(
          yield* pages
            .capture({ ...input, id: "wrong", threadId: ThreadId.make("other") })
            .pipe(Effect.exit),
        ),
      );
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'running' WHERE run_id = 'run'`;
      assert.isTrue(
        Exit.isFailure(yield* pages.capture({ ...input, id: "active" }).pipe(Effect.exit)),
      );
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run'`;
      yield* sql`UPDATE orchestration_v2_projection_messages SET payload_json = ${JSON.stringify({ text: "x".repeat(WORKSPACE_NOTE_MAX_LENGTH + 1) })} WHERE message_id = 'reply'`;
      assert.isTrue(
        Exit.isFailure(yield* pages.capture({ ...input, id: "too-large" }).pipe(Effect.exit)),
      );
      assert.isNull(yield* pages.read({ id: "too-large" }));
    }).pipe(Effect.provide(memory)),
);

it.effect("retains page names, Markdown and source links after reopening the database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-pages-" });
    const database = () =>
      Pages.layer.pipe(Layer.provide(Sqlite.layerFromPath(`${dir}/pages.sqlite`)));
    const saved = yield* Effect.gen(function* () {
      const pages = yield* Pages.WorkspacePages;
      return yield* pages.write({
        id: "research",
        content: {
          ...content,
          source: { threadId: ThreadId.make("work"), runId: RunId.make("saved-output") },
        },
        expectedRevision: 0,
      });
    }).pipe(Effect.provide(database()));
    const reopened = yield* Effect.gen(function* () {
      return yield* (yield* Pages.WorkspacePages).read({ id: "research" });
    }).pipe(Effect.provide(database()));
    assert.deepEqual(reopened, saved.page);
  }).pipe(Effect.provide(NodeServices.layer)),
);
