import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
const isFailure = Schema.is(OrchestratorMcpFailure);
import * as BotStore from "../../../bots/BotStore.ts";
import * as ProjectTeams from "../../../bots/ProjectTeams.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertNotLinked } from "../../linkOrigin.ts";
import { readCaller, assertFullAccess } from "../../threadAccess.ts";
import { BotsToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(BotsToolkit, {
  t3_bot_list: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      yield* assertNotLinked(caller, "read this environment's persistent Bot identities");
      const bots = yield* (yield* BotStore.BotStore).list();
      const teams = yield* (yield* ProjectTeams.ProjectTeams).read();
      const projectId = input.projectId ?? caller.caller?.projectId;
      return {
        bots: bots.bots
          .filter((bot) => !bot.archived)
          .map((bot) => ({
            id: bot.id,
            name: bot.config.name,
            avatar: bot.config.avatar,
            description: bot.config.description,
            home: bot.home,
            revision: bot.revision,
          })),
        team: teams.teams.find((team) => team.projectId === projectId) ?? null,
      };
    }).pipe(
      Effect.mapError((cause) =>
        isFailure(cause)
          ? cause
          : new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: "Could not read the saved Bot directory.",
            }),
      ),
    ),
  ),
  t3_bot_create: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      yield* assertFullAccess(caller, "Creating persistent Bots requires full access.");
      if (!caller.scope.thread || caller.scope.thread.subagent)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Create persistent teammates from the home assistant conversation.",
        });
      const bot = yield* (yield* BotStore.BotStore)
        .createFromAssistant(input, caller.scope.thread.threadId)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return {
        id: bot.id,
        name: bot.config.name,
        description: bot.config.description,
        revision: bot.revision,
      };
    }),
  ),
  t3_bot_update: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      yield* assertFullAccess(caller, "Editing persistent Bots requires full access.");
      if (!caller.scope.thread || caller.scope.thread.subagent)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "Edit persistent teammates from an assistant relationship conversation.",
        });
      const result = yield* (yield* BotStore.BotStore)
        .updateFromAssistant(input, caller.scope.thread.threadId)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
      return { status: result.status, id: result.bot.id, revision: result.bot.revision };
    }),
  ),
});
