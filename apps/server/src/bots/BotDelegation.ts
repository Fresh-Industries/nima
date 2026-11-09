import {
  BotId,
  type ModelSelection,
  OrchestratorMcpFailure,
  type ProjectId,
  type ThreadId,
  type RunId,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as BotStore from "./BotStore.ts";

export interface DelegationReservation {
  readonly threadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly parentRunId?: RunId;
  readonly projectId: ProjectId;
  readonly personal?: boolean;
  readonly coordinatorBotId?: BotId;
  readonly title: string;
  readonly objective: string;
}
const isFailure = Schema.is(OrchestratorMcpFailure);
const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const limit = (name: string, fallback: number) =>
  Config.Int(name).pipe(Config.withDefault(fallback));
export class BotDelegation extends Context.Service<
  BotDelegation,
  {
    readonly assertLocal: (parentThreadId: ThreadId) => Effect.Effect<void, OrchestratorMcpFailure>;
    readonly reserve: (
      input: DelegationReservation,
    ) => Effect.Effect<ModelSelection | null, OrchestratorMcpFailure>;
    readonly reconcile: (threadId: ThreadId) => Effect.Effect<void>;
  }
>()("t3/bots/BotDelegation") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bots = yield* BotStore.BotStore;
  const limits = {
    depth: yield* limit("BARA_BOT_MAX_DEPTH", 3),
    concurrent: yield* limit("BARA_BOT_MAX_CONCURRENT", 4),
    tasks: yield* limit("BARA_BOT_MAX_TASKS", 20),
    attempts: yield* limit("BARA_BOT_MAX_ATTEMPTS", 2),
  };
  if (Object.values(limits).some((value) => value < 1))
    return yield* Effect.die(new Error("Bara Bot limits must be positive integers."));
  // Only one Bara backend owns this database; interrupted pre-dispatch reservations can be retried after restart.
  yield* sql`UPDATE workspace_bot_delegations SET state=CASE WHEN EXISTS(SELECT 1 FROM orchestration_v2_projection_threads thread WHERE thread.thread_id=workspace_bot_delegations.thread_id) THEN 'started' ELSE 'failed' END WHERE state='reserved'`;
  const reserve = Effect.fn("BotDelegation.reserve")(
    function* (input: DelegationReservation) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [parent] = yield* sql<{
            root_thread_id: string;
            depth: number;
          }>`SELECT root_thread_id,depth FROM workspace_bot_delegations WHERE thread_id=${input.parentThreadId}`;
          const relationship = yield* bots.forThread(input.parentThreadId);
          const work = yield* bots.workForThread(input.parentThreadId);
          if (!parent && !relationship && !work && !input.coordinatorBotId) return null;
          if (!input.objective.trim() || input.objective.length > 20000 || input.title.length > 240)
            return yield* failure(
              "Bot work needs a self-contained objective of at most 20,000 characters and a title of at most 240 characters.",
            );
          const [caller] = yield* sql<{
            project_id: string;
          }>`SELECT project_id FROM orchestration_v2_projection_threads WHERE thread_id=${input.parentThreadId} AND deleted_at IS NULL`;
          if (!caller) return yield* failure("The calling conversation is unavailable.");
          const projectId =
            input.personal === true
              ? null
              : caller.project_id === input.projectId && (relationship || work?.projectId === null)
                ? null
                : input.projectId;
          const [existing] = yield* sql<{
            parent_thread_id: string;
            scope_project_id: string | null;
            coordinator_bot_id: string | null;
            title: string;
            objective: string;
            state: string;
            attempts: number;
          }>`SELECT * FROM workspace_bot_delegations WHERE thread_id=${input.threadId}`;
          if (
            existing &&
            (existing.parent_thread_id !== input.parentThreadId ||
              existing.scope_project_id !== projectId ||
              existing.coordinator_bot_id !== (input.coordinatorBotId ?? null) ||
              existing.title !== input.title ||
              existing.objective !== input.objective)
          )
            return yield* failure(
              "This request already created different Bot work. Use its original request key or start a new objective.",
            );
          const [shell] =
            yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id=${input.threadId}`;
          if (existing && shell) return null;
          if (existing?.state === "reserved")
            return yield* failure(
              "This Bot work request is already starting. Reuse the same request key after it returns.",
            );
          if (existing && existing.attempts >= limits.attempts)
            return yield* failure(
              "This Bot work request reached its retry limit. Review the failure before starting another objective.",
            );
          const coordinator = input.coordinatorBotId
            ? yield* bots.get(input.coordinatorBotId)
            : null;
          if (coordinator?.archived)
            return yield* failure("Restore this Bot before assigning new work.");
          if (
            projectId !== null &&
            coordinator?.config.capabilities?.toolPolicy.projectIds != null &&
            !coordinator.config.capabilities.toolPolicy.projectIds.some((id) => id === projectId)
          )
            return yield* failure(
              "This Bot is not authorized for the selected project. Change its resource permissions first.",
            );
          const root =
            parent?.root_thread_id ??
            (relationship ? `${input.parentThreadId}:${input.parentRunId}` : input.parentThreadId);
          const depth = (parent?.depth ?? 0) + 1;
          if (depth > limits.depth)
            return yield* failure(
              `Bot work reached its delegation depth limit (${limits.depth}). Return the result to its coordinator.`,
            );
          const [counts] = yield* sql<{
            total: number;
            busy: number;
          }>`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN task.state='reserved' OR EXISTS(SELECT 1 FROM workspace_work_activity activity WHERE activity.thread_id=task.thread_id AND activity.busy=1) THEN 1 ELSE 0 END),0) AS busy FROM workspace_bot_delegations task`;
          const [rootCount] = yield* sql<{
            total: number;
          }>`SELECT COUNT(*) AS total FROM workspace_bot_delegations WHERE root_thread_id=${root}`;
          if (!existing && (rootCount?.total ?? 0) >= limits.tasks)
            return yield* failure(
              `This objective reached its task limit (${limits.tasks}). Review its results before starting more work.`,
            );
          if ((counts?.busy ?? 0) >= limits.concurrent)
            return yield* failure(
              `This objective already has ${limits.concurrent} active workers. Continue when one completes.`,
            );
          if (shell)
            return yield* failure(
              "This conversation already exists without a matching Bot work reservation.",
            );
          const [metadata] = yield* sql<{
            coordinator_bot_id: string | null;
            scope_project_id: string | null;
            title: string;
            objective: string;
          }>`SELECT * FROM workspace_thread_metadata WHERE thread_id=${input.threadId}`;
          if (
            metadata &&
            (metadata.coordinator_bot_id !== (input.coordinatorBotId ?? null) ||
              metadata.scope_project_id !== projectId ||
              metadata.title !== input.title ||
              metadata.objective !== input.objective)
          )
            return yield* failure("This conversation already has a different Work configuration.");
          yield* sql`INSERT INTO workspace_bot_delegations(thread_id,parent_thread_id,root_thread_id,depth,state,coordinator_bot_id,scope_project_id,title,objective) VALUES(${input.threadId},${input.parentThreadId},${root},${depth},'reserved',${input.coordinatorBotId ?? null},${projectId},${input.title},${input.objective}) ON CONFLICT(thread_id) DO UPDATE SET state='reserved',attempts=attempts+1`;
          yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,scope_project_id,coordinator_bot_id,configuration_revision) VALUES(${input.threadId},'focus',${input.title},${input.objective},${DateTime.formatIso(yield* DateTime.now)},${projectId},${input.coordinatorBotId ?? null},1) ON CONFLICT(thread_id) DO NOTHING`;
          return coordinator?.config.modelSelection ?? null;
        }),
      );
    },
    Effect.mapError((cause) =>
      isFailure(cause)
        ? cause
        : new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not reserve this Bot's work.",
          }),
    ),
    Effect.uninterruptible,
  );
  const reconcile = Effect.fn("BotDelegation.reconcile")(
    function* (threadId: ThreadId) {
      yield* sql`UPDATE workspace_bot_delegations SET state=CASE WHEN EXISTS(SELECT 1 FROM orchestration_v2_projection_threads thread WHERE thread.thread_id=${threadId}) THEN 'started' ELSE 'failed' END WHERE thread_id=${threadId} AND state='reserved'`;
    },
    Effect.catch((cause) => Effect.logWarning("Bot work reservation recovery failed", { cause })),
  );
  const assertLocal = Effect.fn("BotDelegation.assertLocal")(
    function* (parentThreadId: ThreadId) {
      const [managed] =
        yield* sql`SELECT thread_id FROM workspace_bot_delegations WHERE thread_id=${parentThreadId}`;
      if (
        managed ||
        (yield* bots.forThread(parentThreadId)) ||
        (yield* bots.workForThread(parentThreadId))
      )
        return yield* failure(
          "Bot-managed work currently runs on this Bara environment. Remote Bot teams are not supported yet.",
        );
    },
    Effect.mapError((cause) =>
      isFailure(cause)
        ? cause
        : new OrchestratorMcpFailure({
            code: "orchestration_error",
            message: "Could not check this Bot's work boundary.",
          }),
    ),
  );
  return BotDelegation.of({ reserve, reconcile, assertLocal });
});
export const layer = Layer.effect(BotDelegation, make);
