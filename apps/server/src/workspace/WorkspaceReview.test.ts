import { BotId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type { WorkspaceReviewSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Review from "./WorkspaceReview.ts";

const service = Review.layer.pipe(Layer.provide(Layer.mock(EventSinkV2)({})));
const memory = service.pipe(Layer.provideMerge(Sqlite.layerMemory));
const at = "2026-11-04T12:00:00.000Z";
const input = {
  threadIds: [ThreadId.make("focus"), ThreadId.make("assistant")],
  view: "review",
} as const;
const seedThread = Effect.fn(function* (id: string, payload: Record<string, unknown> = {}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
    VALUES (${id}, 'workspace', ${id}, 'devReplay', 'full-access', 'default', ${at}, ${at}, ${JSON.stringify(payload)})`;
});
const seedRun = Effect.fn(function* (
  thread: string,
  id: string,
  ordinal: number,
  bot: string | null = null,
  status = "completed",
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (${`${id}-user`}, ${thread}, 'user', 0, ${at}, ${at}, ${JSON.stringify(bot ? { scheduledTaskId: bot } : {})})`;
  yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, completed_at, payload_json)
    VALUES (${id}, ${thread}, ${ordinal}, 'devReplay', ${status}, ${at}, ${status === "running" ? null : at}, ${JSON.stringify({ userMessageId: `${id}-user` })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (${`${id}-reply`}, ${thread}, ${id}, 'assistant', 0, ${at}, ${at}, ${JSON.stringify({ text: `# Result ${id}\n\n**Saved output**` })})`;
});

it.effect("streams committed review changes to another connected reader", () =>
  Effect.gen(function* () {
    const review = yield* Review.WorkspaceReview;
    yield* seedThread("focus");
    yield* seedRun("focus", "result", 1);
    const snapshots = yield* Queue.unbounded<WorkspaceReviewSnapshot>();
    const reader = yield* review.subscribe(input).pipe(
      Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
      Effect.forkChild,
    );
    assert.equal((yield* Queue.take(snapshots)).pendingCount, 1);
    yield* review.write({ action: "settle", key: "focus:focus", version: "result" });
    yield* TestClock.adjust("30 millis");
    assert.equal((yield* Queue.take(snapshots)).pendingCount, 0);
    yield* review.write({ action: "reopen", key: "focus:focus", version: "result" });
    yield* TestClock.adjust("30 millis");
    assert.equal((yield* Queue.take(snapshots)).metadata[0]?.state, "active");
    yield* Fiber.interrupt(reader);
  }).pipe(
    Effect.provide(
      Review.layer.pipe(
        Layer.provide(
          Layer.mock(EventSinkV2)({
            latestSequence: () => Effect.succeed(0),
            stream: () => Stream.never,
          }),
        ),
        Layer.provideMerge(Sqlite.layerMemory),
      ),
    ),
  ),
);

it.effect(
  "keeps each bot outcome separate, excludes assistant chat and acknowledges only the reviewed version",
  () =>
    Effect.gen(function* () {
      const review = yield* Review.WorkspaceReview;
      const sql = yield* SqlClient.SqlClient;
      yield* seedThread("focus", { settledAt: at }); // Automatic T3 settlement is not a user's review.
      yield* seedThread("assistant");
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("assistant"),
        kind: "assistant",
        title: "",
        objective: "",
        review: false,
      });
      yield* seedRun("assistant", "chat", 1);
      yield* seedRun("assistant", "bot-one", 2, "daily");
      yield* sql`INSERT INTO workspace_goal_checkin_messages (message_id, goal_id, task_id) VALUES ('bot-one-user', 'guide', 'daily')`;
      assert.equal(
        (yield* review.read(input)).items.find((item) => item.runId === "bot-one")?.goalId,
        "guide",
      );
      yield* seedRun("assistant", "bot-two", 3, "daily", "failed");
      yield* seedRun("focus", "first", 1);
      let snapshot = yield* review.read(input);
      assert.deepEqual(snapshot.items.map((item) => item.key).sort(), [
        "bot:bot-one",
        "bot:bot-two",
        "focus:focus",
      ]);
      assert.equal(snapshot.pendingCount, 3);
      assert.equal(
        snapshot.items.find((item) => item.runId === "first")?.summary,
        "# Result first\n\n**Saved output**",
      );
      yield* review.write({ action: "settle", key: "bot:bot-one", version: "bot-one" });
      assert.equal((yield* review.read(input)).pendingCount, 2);
      assert.deepEqual(
        (yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = 'assistant'`)[0]
          ?.payload_json,
        "{}",
      );
      yield* review.write({ action: "settle", key: "focus:focus", version: "first" });
      yield* seedRun("focus", "second", 2);
      assert.isTrue(
        Exit.isFailure(
          yield* review
            .write({ action: "settle", key: "focus:focus", version: "first" })
            .pipe(Effect.exit),
        ),
      );
      snapshot = yield* review.read(input);
      assert.equal(snapshot.items.find((item) => item.key === "focus:focus")?.version, "second");
      assert.equal(snapshot.pendingCount, 2);
      yield* review.write({ action: "reopen", key: "focus:focus", version: "second" });
      snapshot = yield* review.read(input);
      assert.equal(snapshot.pendingCount, 1);
      assert.equal(snapshot.metadata.find((meta) => meta.threadId === "focus")?.state, "active");
      yield* seedRun("focus", "third", 3, null, "running");
      assert.isFalse((yield* review.read(input)).items.some((item) => item.kind === "focus"));
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed', completed_at = ${at} WHERE run_id = 'third'`;
      assert.equal(
        (yield* review.read(input)).items.find((item) => item.kind === "focus")?.version,
        "third",
      );
      yield* review.write({ action: "reopen", key: "bot:bot-one", version: "bot-one" });
      assert.equal((yield* review.read(input)).pendingCount, 3);
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "imports metadata once, respects explicit lifecycle state and omits archived or delegated work",
  () =>
    Effect.gen(function* () {
      const review = yield* Review.WorkspaceReview;
      const sql = yield* SqlClient.SqlClient;
      yield* seedThread("focus");
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("focus"),
        kind: "focus",
        title: "Field guide",
        objective: "Finish the draft",
        review: true,
      });
      assert.equal((yield* review.read(input)).items[0]?.version, "manual");
      yield* review.write({ action: "settle", key: "focus:focus", version: "manual" });
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("focus"),
        kind: "focus",
        title: "Stale browser title",
        objective: "",
        review: true,
      });
      assert.equal((yield* review.read(input)).pendingCount, 0);
      assert.equal((yield* review.read(input)).metadata[0]?.title, "Field guide");
      for (const [id, payload] of [
        ["explicit", { settledOverride: "settled", settledAt: at }],
        ["resumed", { settledOverride: "active", unsettledAt: at }],
        ["child", { lineage: { relationshipToParent: "subagent" } }],
        ["side", { lineage: { sideChat: true } }],
      ] as const) {
        yield* seedThread(id, payload);
        yield* seedRun(id, `${id}-run`, 1);
      }
      assert.equal((yield* review.read(input)).pendingCount, 0);
      assert.equal((yield* review.read({ ...input, view: "settled" })).items.length, 2);
      yield* seedRun("focus", "new-result", 1);
      assert.equal((yield* review.read(input)).pendingCount, 1);
      yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at = ${at} WHERE thread_id = 'focus'`;
      assert.equal((yield* review.read(input)).pendingCount, 0);
    }).pipe(Effect.provide(memory)),
);

it.effect("paginates tied completion timestamps without losing bot runs", () =>
  Effect.gen(function* () {
    const review = yield* Review.WorkspaceReview;
    yield* seedThread("assistant");
    for (let index = 0; index < 53; index++)
      yield* seedRun("assistant", `bot-${index}`, index + 1, "daily");
    const first = yield* review.read(input);
    assert.equal(first.items.length, 50);
    assert.equal(first.pendingCount, 53);
    const second = yield* review.read({ ...input, before: first.nextCursor! });
    assert.equal(second.items.length, 3);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.key)).size, 53);
    assert.isNull(second.nextCursor);
  }).pipe(Effect.provide(memory)),
);

it.effect(
  "sends a resumed result back to Inbox and rejects handoffs that cannot produce an item",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(at) + 1000);
      const review = yield* Review.WorkspaceReview;
      const sql = yield* SqlClient.SqlClient;
      yield* seedThread("focus", { settledOverride: "active", unsettledAt: at });
      yield* seedRun("focus", "finished", 1);
      assert.equal((yield* review.read(input)).pendingCount, 0);
      yield* review.write({ action: "request", threadId: ThreadId.make("focus") });
      let snapshot = yield* review.read(input);
      assert.equal(snapshot.pendingCount, 1);
      assert.equal(snapshot.items[0]?.runId, "finished");
      assert.include(snapshot.items[0]?.summary ?? "", "Saved output");
      yield* review.write({ action: "request", threadId: ThreadId.make("focus") });
      assert.equal((yield* review.read(input)).pendingCount, 1);
      yield* seedThread("child", { lineage: { relationshipToParent: "subagent" } });
      yield* seedRun("child", "child-result", 1);
      assert.equal(
        (yield* review
          .write({ action: "request", threadId: ThreadId.make("child") })
          .pipe(Effect.flip)).reason,
        "unavailable",
      );
      assert.equal(
        (yield* sql`SELECT * FROM workspace_review_marks WHERE thread_id='child'`).length,
        0,
      );
      snapshot = yield* review.read(input);
      assert.equal(snapshot.pendingCount, 1);
    }).pipe(Effect.provide(memory)),
);

it.effect(
  "reviews direct assistant delegations, keeps nested work inside the session, and waits for pending child delivery",
  () =>
    Effect.gen(function* () {
      const review = yield* Review.WorkspaceReview;
      const sql = yield* SqlClient.SqlClient;
      yield* seedThread("assistant");
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("assistant"),
        kind: "assistant",
        title: "",
        objective: "",
        review: false,
      });
      for (const [id, parent, origin] of [
        ["session", "assistant", "app_owned"],
        ["native", "assistant", "provider_native"],
        ["nested", "session", "app_owned"],
      ] as const) {
        yield* seedThread(id, {
          lineage: { relationshipToParent: "subagent", parentThreadId: parent },
        });
        yield* seedRun(id, `${id}-result`, 1);
        yield* sql`INSERT INTO orchestration_v2_projection_subagents(subagent_id,thread_id,parent_node_id,provider,child_thread_id,origin,status,updated_at,payload_json) VALUES(${`task-${id}`},${parent},'root','devReplay',${id},${origin},'completed',${at},'{}')`;
      }
      // A session's own delegation is a Work session too: it can be sent to the Inbox.
      yield* sql`INSERT INTO workspace_bot_delegations(thread_id,parent_thread_id,root_thread_id,depth,state,title,objective) VALUES('nested','session','session',1,'completed','nested','')`;
      yield* review.write({ action: "request", threadId: ThreadId.make("nested") });
      yield* review.write({ action: "settle", key: "focus:nested", version: "nested-result" });
      yield* sql`DELETE FROM workspace_bot_delegations`;
      yield* sql`DELETE FROM workspace_review_marks`;
      const query = { ...input, threadIds: [ThreadId.make("session"), ThreadId.make("nested")] };
      const result = yield* review.read(query);
      assert.deepEqual(
        result.items.map((item) => item.threadId),
        ["session"],
      );
      assert.equal(
        result.metadata.find((meta) => meta.threadId === "session")?.assistantWork,
        true,
      );
      assert.equal(result.metadata.find((meta) => meta.threadId === "session")?.kind, "focus");
      yield* review.write({ action: "settle", key: "focus:session", version: "session-result" });
      assert.equal((yield* review.read(query)).pendingCount, 0);
      yield* seedRun("session", "follow-up", 2);
      assert.equal((yield* review.read(query)).items[0]?.version, "follow-up");
      yield* sql`UPDATE orchestration_v2_projection_subagents SET status='running' WHERE subagent_id='task-nested'`;
      assert.equal((yield* review.read(query)).pendingCount, 0);
      assert.equal(
        (yield* review.read(query)).metadata.find((meta) => meta.threadId === "session")
          ?.assistantWorkPending,
        true,
      );
      assert.equal(
        (yield* review.read(query)).metadata.find((meta) => meta.threadId === "session")?.state,
        "active",
      );
      yield* sql`UPDATE orchestration_v2_projection_subagents SET status='completed',payload_json='{"completionDelivery":{"state":"pending"}}' WHERE subagent_id='task-nested'`;
      assert.equal((yield* review.read(query)).pendingCount, 0);
      yield* sql`UPDATE orchestration_v2_projection_subagents SET payload_json='{"completionDelivery":{"state":"delivered"}}' WHERE subagent_id='task-nested'`;
      assert.equal((yield* review.read(query)).items[0]?.version, "follow-up");
      // A new canonical assistant must not hide work the previous assistant already authorized.
      yield* sql`UPDATE workspace_bots SET thread_id='replacement' WHERE bot_id='primary'`;
      assert.equal((yield* review.read(query)).items[0]?.threadId, "session");
    }).pipe(Effect.provide(memory)),
);

it.effect("keeps review and Focus identity after closing and reopening the database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-review-" });
    const database = () =>
      service.pipe(Layer.provideMerge(Sqlite.layerFromPath(`${dir}/reviews.sqlite`)));
    yield* Effect.gen(function* () {
      yield* seedThread("focus");
      yield* seedRun("focus", "saved", 1);
      const review = yield* Review.WorkspaceReview;
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("focus"),
        kind: "focus",
        title: "My session",
        objective: "",
        review: false,
      });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO workspace_bots(bot_id,description,config_json) SELECT 'saved-lead','Engineering',config_json FROM workspace_bots WHERE bot_id='primary'`;
      yield* review.write({
        action: "coordinate",
        threadId: ThreadId.make("focus"),
        coordinatorBotId: BotId.make("saved-lead"),
        expectedRevision: 0,
      });
      yield* review.write({ action: "settle", key: "focus:focus", version: "saved" });
    }).pipe(Effect.provide(database()));
    const reopened = yield* Effect.gen(function* () {
      const review = yield* Review.WorkspaceReview;
      return yield* review.read({ ...input, view: "settled" });
    }).pipe(Effect.provide(database()));
    assert.equal(reopened.items[0]?.title, "My session");
    assert.equal(reopened.items[0]?.state, "settled");
    assert.equal(reopened.pendingCount, 0);
    assert.equal(
      reopened.metadata.find((meta) => meta.threadId === "focus")?.coordinatorBotId,
      "saved-lead",
    );
    assert.equal(
      reopened.metadata.find((meta) => meta.threadId === "focus")?.configurationRevision,
      1,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "coordinates idle Work with revision checks and holds Inbox handoffs until delegated work and completion delivery finish",
  () =>
    Effect.gen(function* () {
      const review = yield* Review.WorkspaceReview;
      const sql = yield* SqlClient.SqlClient;
      yield* seedThread("focus");
      yield* seedThread("worker");
      yield* seedThread("assistant");
      yield* sql`INSERT INTO workspace_bots(bot_id,description,config_json) SELECT 'lead','Engineering',config_json FROM workspace_bots WHERE bot_id='primary'`;
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("focus"),
        kind: "focus",
        title: "Checkout fix",
        objective: "Investigate checkout",
        review: false,
      });
      yield* review.write({
        action: "remember",
        threadId: ThreadId.make("assistant"),
        kind: "assistant",
        title: "",
        objective: "",
        review: false,
      });
      const assignment = {
        action: "coordinate" as const,
        threadId: ThreadId.make("focus"),
        coordinatorBotId: BotId.make("lead"),
        expectedRevision: 0,
      };
      yield* review.write(assignment);
      let meta = (yield* review.read(input)).metadata.find((row) => row.threadId === "focus")!;
      assert.equal(meta.coordinatorBotId, "lead");
      assert.equal(meta.configurationRevision, 1);
      assert.equal(
        (yield* review.write(assignment).pipe(Effect.flip)).reason,
        "configuration-changed",
      );
      assert.equal(
        (yield* review
          .write({ ...assignment, threadId: ThreadId.make("assistant") })
          .pipe(Effect.flip)).reason,
        "unavailable",
      );
      assert.equal(
        (yield* review
          .write({
            ...assignment,
            coordinatorBotId: BotId.make("another-environment-bot"),
            expectedRevision: 1,
          })
          .pipe(Effect.flip)).reason,
        "unavailable",
      );
      yield* seedRun("focus", "result", 1);
      yield* sql`INSERT INTO orchestration_v2_projection_subagents(subagent_id,thread_id,parent_node_id,provider,child_thread_id,origin,status,updated_at,payload_json) VALUES('worker-task','focus','root','devReplay','worker','app_owned','running',${at},'{}')`;
      let snapshot = yield* review.read(input);
      assert.lengthOf(snapshot.items, 0);
      assert.equal(snapshot.pendingCount, 0);
      meta = snapshot.metadata.find((row) => row.threadId === "focus")!;
      assert.isTrue(meta.workPending);
      assert.equal(
        (yield* review
          .write({ ...assignment, coordinatorBotId: null, expectedRevision: 1 })
          .pipe(Effect.flip)).reason,
        "busy",
      );
      assert.equal(
        (yield* review
          .write({ action: "request", threadId: ThreadId.make("focus") })
          .pipe(Effect.flip)).reason,
        "busy",
      );
      yield* sql`UPDATE orchestration_v2_projection_subagents SET status='completed',payload_json='{"completionDelivery":{"state":"pending"}}' WHERE subagent_id='worker-task'`;
      assert.equal((yield* review.read(input)).pendingCount, 0);
      yield* sql`UPDATE orchestration_v2_projection_subagents SET payload_json='{}' WHERE subagent_id='worker-task'`;
      snapshot = yield* review.read(input);
      assert.equal(snapshot.pendingCount, 1);
      yield* review.write({ action: "settle", key: "focus:focus", version: "result" });
      assert.equal((yield* review.read(input)).pendingCount, 0);
      yield* review.write({ action: "reopen", key: "focus:focus", version: "result" });
      yield* review.write({ ...assignment, coordinatorBotId: null, expectedRevision: 1 });
      meta = (yield* review.read(input)).metadata.find((row) => row.threadId === "focus")!;
      assert.isNull(meta.coordinatorBotId);
      assert.equal(meta.configurationRevision, 2);
      assert.equal(
        (yield* sql<{
          status: string;
        }>`SELECT status FROM orchestration_v2_projection_subagents WHERE subagent_id='worker-task'`)[0]
          ?.status,
        "completed",
      );
      assert.equal(
        (yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM workspace_bots WHERE bot_id='lead'`)[0]?.count,
        1,
      );
    }).pipe(Effect.provide(memory)),
);
