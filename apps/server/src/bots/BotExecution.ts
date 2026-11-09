import { CommandId, RunId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import * as BotStore from "./BotStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

export class BotExecution extends Context.Service<
  BotExecution,
  {
    readonly tick: () => Effect.Effect<void>;
    readonly start: () => Effect.Effect<void, never, import("effect/Scope").Scope>;
  }
>()("t3/bots/BotExecution") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bots = yield* BotStore.BotStore;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const tick = Effect.fn("BotExecution.tick")(
    function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const runs = yield* sql<{
        run_id: string;
        thread_id: string;
        started_at: string;
        tokens: number | null;
        cost: number | null;
        currency: string | null;
      }>`SELECT run.run_id,run.thread_id,
      COALESCE(json_extract(run.payload_json,'$.workStartedAt'),json_extract(run.payload_json,'$.startedAt'),run.requested_at) AS started_at,
      COALESCE(json_extract(provider.payload_json,'$.contextUsage.totalProcessedTokens'),json_extract(provider.payload_json,'$.contextUsage.usedTokens')) AS tokens,
      json_extract(provider.payload_json,'$.contextUsage.cost.amount') AS cost,
      json_extract(provider.payload_json,'$.contextUsage.cost.currency') AS currency
      FROM orchestration_v2_projection_runs run LEFT JOIN orchestration_v2_projection_provider_threads provider ON provider.provider_thread_id=run.provider_thread_id
      WHERE run.status IN ('running','waiting') AND (
        EXISTS(SELECT 1 FROM workspace_bots WHERE thread_id=run.thread_id) OR
        EXISTS(SELECT 1 FROM workspace_thread_metadata WHERE thread_id=run.thread_id AND coordinator_bot_id IS NOT NULL) OR
        EXISTS(SELECT 1 FROM workspace_bot_delegations WHERE thread_id=run.thread_id) OR
        EXISTS(SELECT 1 FROM orchestration_v2_projection_threads thread WHERE thread.thread_id=run.thread_id AND json_extract(thread.payload_json,'$.lineage.relationshipToParent')='subagent'))`;
      yield* Effect.forEach(
        runs,
        Effect.fn("BotExecution.checkRun")(
          function* (run) {
            const profiles = yield* bots.policiesForThread(ThreadId.make(run.thread_id));
            const minimum = (values: ReadonlyArray<number | null | undefined>) => {
              const defined = values.filter((n): n is number => n != null);
              return defined.length ? Math.min(...defined) : null;
            };
            const minutes = minimum(profiles.map((p) => p.config.capabilities?.maxRunMinutes));
            const tokens = minimum(profiles.map((p) => p.config.capabilities?.maxReportedTokens));
            const cost = minimum(profiles.map((p) => p.config.capabilities?.maxReportedCostUsd));
            const reason =
              minutes !== null && now - Date.parse(run.started_at) >= minutes * 60000
                ? "elapsed run time"
                : tokens !== null && run.tokens !== null && run.tokens >= tokens
                  ? "reported conversation tokens"
                  : cost !== null &&
                      run.currency?.toUpperCase() === "USD" &&
                      run.cost !== null &&
                      run.cost >= cost
                    ? "reported conversation spend"
                    : null;
            if (reason !== null)
              yield* orchestrator.dispatch({
                type: "run.interrupt",
                commandId: CommandId.make(`bara-budget:${run.run_id}`),
                threadId: ThreadId.make(run.thread_id),
                runId: RunId.make(run.run_id),
                holdQueue: true,
                reason: `Bara execution limit reached: ${reason}. Review the run and its limits before resuming queued work.`,
              });
          },
          Effect.catch(() =>
            Effect.logWarning(
              "Could not check a Bara run limit; other runs will still be checked.",
            ),
          ),
        ),
      );
    },
    Effect.catch(() =>
      Effect.logWarning("Could not check Bara execution limits; the backend will retry."),
    ),
  );
  return BotExecution.of({
    tick,
    start: Effect.fn("BotExecution.start")(function* () {
      yield* tick().pipe(Effect.repeat(Schedule.spaced("5 seconds")), Effect.forkScoped);
    }),
  });
});
export const layer = Layer.effect(BotExecution, make);
