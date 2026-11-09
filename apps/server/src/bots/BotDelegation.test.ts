import { assert, it } from "@effect/vitest";
import { BotId, HOME_BOT_ID, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as BotStore from "./BotStore.ts";
import * as BotDelegation from "./BotDelegation.ts";

const memory = BotDelegation.layer.pipe(
  Layer.provideMerge(BotStore.layer),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        BARA_BOT_MAX_DEPTH: 2,
        BARA_BOT_MAX_CONCURRENT: 2,
        BARA_BOT_MAX_TASKS: 3,
        BARA_BOT_MAX_ATTEMPTS: 2,
      }),
    ),
  ),
);
const seed = Effect.fn("test.seedThread")(function* (id: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${id},'scratch','Work','devReplay','approval-required','default','2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z','{}')`;
});
it.effect(
  "reserves before execution, bounds concurrent and recursive work, and preserves idempotent retries",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore,
        delegation = yield* BotDelegation.BotDelegation;
      const home = yield* bots.claimConversation(HOME_BOT_ID);
      yield* seed(home);
      const lead = yield* bots.create({
        id: BotId.make("lead"),
        name: "Lead",
        description: "Coordinate",
      });
      const request = (id: string, parent = home) => ({
        threadId: ThreadId.make(id),
        parentThreadId: parent,
        parentRunId: RunId.make("parent-run"),
        projectId: ProjectId.make("scratch"),
        coordinatorBotId: lead.id,
        title: "Research",
        objective: "Investigate only this objective",
      });
      const attempts = yield* Effect.forEach(
        ["one", "two", "three"],
        (id) => delegation.reserve(request(id)).pipe(Effect.exit),
        { concurrency: "unbounded" },
      );
      assert.lengthOf(attempts.filter(Exit.isSuccess), 2);
      const sql = yield* SqlClient.SqlClient;
      const [first] = yield* sql<{
        thread_id: string;
      }>`SELECT thread_id FROM workspace_bot_delegations ORDER BY thread_id LIMIT 1`;
      const firstId = ThreadId.make(first!.thread_id);
      assert.equal((yield* bots.workForThread(firstId))?.coordinator?.id, lead.id);
      assert.isNull((yield* bots.workForThread(firstId))?.projectId);
      assert.equal(
        (yield* sql`SELECT * FROM orchestration_v2_projection_threads WHERE thread_id=${firstId}`)
          .length,
        0,
      );
      yield* seed(firstId);
      yield* delegation.reconcile(firstId);
      assert.isNull(yield* delegation.reserve(request(firstId)));
      const altered = yield* delegation
        .reserve({ ...request(firstId), objective: "Different task" })
        .pipe(Effect.flip);
      assert.include(altered.message, "different Bot work");
      yield* delegation.reserve(request("nested", firstId));
      yield* seed(ThreadId.make("nested"));
      yield* delegation.reconcile(ThreadId.make("nested"));
      assert.include(
        (yield* delegation.reserve(request("too-deep", ThreadId.make("nested"))).pipe(Effect.flip))
          .message,
        "depth limit",
      );
      assert.include(
        (yield* delegation.reserve(request("over-total")).pipe(Effect.flip)).message,
        "task limit",
      );
      assert.include(
        (yield* delegation.assertLocal(firstId).pipe(Effect.flip)).message,
        "Remote Bot teams",
      );
      const nested = yield* bots.workForThread(ThreadId.make("nested"));
      assert.equal(nested?.coordinator?.id, lead.id);
      assert.isNull(nested?.projectId);
    }).pipe(Effect.provide(memory)),
);
it.effect("releases failed launches but caps retries without duplicating Bot identities", () =>
  Effect.gen(function* () {
    const bots = yield* BotStore.BotStore,
      delegation = yield* BotDelegation.BotDelegation;
    const home = yield* bots.claimConversation(HOME_BOT_ID);
    yield* seed(home);
    const request = {
      threadId: ThreadId.make("failed"),
      parentThreadId: home,
      parentRunId: RunId.make("run"),
      projectId: ProjectId.make("scratch"),
      title: "Research",
      objective: "Use authorized sources",
    };
    yield* delegation.reserve(request);
    yield* delegation.reconcile(request.threadId);
    yield* delegation.reserve(request);
    yield* delegation.reconcile(request.threadId);
    assert.include((yield* delegation.reserve(request).pipe(Effect.flip)).message, "retry limit");
    assert.lengthOf((yield* bots.list()).bots, 1);
  }).pipe(Effect.provide(memory)),
);
