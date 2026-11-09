import { assert, it } from "@effect/vitest";
import {
  BotId,
  DEFAULT_BOT_CAPABILITIES,
  HOME_BOT_ID,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as BotStore from "./BotStore.ts";
import * as BotExecution from "./BotExecution.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { retryProviderPreparation } from "./retryProviderPreparation.ts";

it.effect("retries only bounded transient preparation failures", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0),
      entered = yield* Deferred.make<void>();
    const prepare = Effect.gen(function* () {
      const attempt = yield* Ref.getAndUpdate(attempts, (n) => n + 1);
      if (attempt === 0) {
        yield* Deferred.succeed(entered, undefined);
        return yield* Effect.fail({ cause: { code: "ECONNRESET" } });
      }
      return "prepared";
    });
    const fiber = yield* retryProviderPreparation(prepare, 1).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* TestClock.adjust("500 millis");
    assert.equal(yield* Fiber.join(fiber), "prepared");
    assert.equal(yield* Ref.get(attempts), 2);
    const permanent = yield* Ref.make(0);
    yield* retryProviderPreparation(
      Ref.update(permanent, (n) => n + 1).pipe(Effect.andThen(Effect.fail({ code: "EACCES" }))),
      2,
    ).pipe(Effect.flip);
    assert.equal(yield* Ref.get(permanent), 1);
  }),
);

it.effect("stops only Bot work that exceeds configured elapsed or reported usage limits", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationV2ServerCommand>>([]);
    const rejectElapsed = yield* Ref.make(false);
    const dependencies = BotExecution.layer.pipe(
      Layer.provideMerge(BotStore.layer),
      Layer.provideMerge(Sqlite.layerMemory),
      Layer.provide(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: (command) =>
            Effect.gen(function* () {
              if (
                command.type === "run.interrupt" &&
                command.runId === "elapsed" &&
                (yield* Ref.get(rejectElapsed))
              )
                return yield* new Orchestrator.OrchestratorDispatchError({
                  commandId: command.commandId,
                  commandType: command.type,
                });
              yield* Ref.update(commands, (entries) => [...entries, command]);
              return { sequence: 1, storedEvents: [] };
            }),
        }),
      ),
    );
    yield* Effect.gen(function* () {
      const bots = yield* BotStore.BotStore,
        sql = yield* SqlClient.SqlClient,
        monitor = yield* BotExecution.BotExecution;
      const home = yield* bots.get(HOME_BOT_ID),
        thread = yield* bots.claimConversation(HOME_BOT_ID);
      yield* bots.write({
        id: home.id,
        archived: false,
        expectedRevision: (yield* bots.get(home.id)).revision,
        config: { ...home.config, capabilities: { ...DEFAULT_BOT_CAPABILITIES, maxRunMinutes: 1 } },
      });
      yield* sql`INSERT INTO orchestration_v2_projection_runs(run_id,thread_id,ordinal,provider,status,requested_at,payload_json) VALUES('elapsed',${thread},1,'codex','running','1970-01-01T00:00:00.000Z','{}')`;
      yield* sql`INSERT INTO orchestration_v2_projection_runs(run_id,thread_id,ordinal,provider,status,requested_at,payload_json) VALUES('ordinary','ordinary',1,'codex','running','1960-01-01T00:00:00.000Z','{}')`;
      yield* monitor.tick();
      assert.lengthOf(yield* Ref.get(commands), 0);
      yield* TestClock.adjust("1 minute");
      yield* monitor.tick();
      const first = (yield* Ref.get(commands))[0]!;
      assert.equal(first.type, "run.interrupt");
      if (first.type === "run.interrupt") {
        assert.equal(first.runId, "elapsed");
        assert.isTrue(first.holdQueue);
      }
      yield* monitor.tick();
      assert.equal((yield* Ref.get(commands))[1]!.commandId, first.commandId);
      const researcher = yield* bots.create({
        id: BotId.make("researcher"),
        name: "Researcher",
        description: "Research",
      });
      const research = yield* bots.claimConversation(researcher.id);
      yield* bots.write({
        id: researcher.id,
        archived: false,
        expectedRevision: (yield* bots.get(researcher.id)).revision,
        config: {
          ...researcher.config,
          capabilities: { ...DEFAULT_BOT_CAPABILITIES, maxReportedTokens: 1000 },
        },
      });
      yield* sql`INSERT INTO orchestration_v2_projection_runs(run_id,thread_id,ordinal,provider,status,provider_thread_id,requested_at,payload_json) VALUES('reported',${research},1,'codex','running','provider-research','1970-01-01T00:00:00.000Z','{}')`;
      yield* monitor.tick();
      assert.isFalse(
        (yield* Ref.get(commands)).some(
          (c) => c.type === "run.interrupt" && c.runId === "reported",
        ),
      );
      yield* sql`INSERT INTO orchestration_v2_projection_provider_threads(provider_thread_id,thread_id,provider,status,updated_at,payload_json) VALUES('provider-research',${research},'codex','ready','1970-01-01','{"contextUsage":{"usedTokens":1200}}')`;
      yield* Ref.set(rejectElapsed, true);
      yield* monitor.tick();
      assert.isTrue(
        (yield* Ref.get(commands)).some(
          (c) => c.type === "run.interrupt" && c.runId === "reported",
        ),
      );
    }).pipe(Effect.provide(dependencies));
  }),
);
