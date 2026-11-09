import {
  BotId,
  BotAssistantCreateInput,
  BotAssistantUpdateInput,
  ProjectId,
  ProjectTeam,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ProjectTeams from "../../../bots/ProjectTeams.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const BotsToolkit = Toolkit.make(
  Tool.make("t3_bot_list", {
    description:
      "Find existing persistent Bara teammates by id, name and responsibility. Optionally read an existing project's reusable team. Use coordinatorBotId with delegate_task for this checkout or t3_thread_launch for another project's Work. Membership is organizational, not a tool or resource permission. Does not read Bot conversations, memory or private instructions.",
    parameters: Schema.Struct({ projectId: Schema.optional(ProjectId) }),
    success: Schema.Struct({
      bots: Schema.Array(
        Schema.Struct({
          id: BotId,
          name: Schema.String,
          avatar: Schema.String,
          description: Schema.String,
          home: Schema.Boolean,
          revision: Schema.Int,
        }),
      ),
      team: Schema.NullOr(ProjectTeam),
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      BotStore.BotStore,
      ProjectTeams.ProjectTeams,
      ThreadManagement.ThreadManagementService,
      McpInvocationContext.McpInvocationContext,
    ],
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_bot_create", {
    description:
      "Create a persistent Bara teammate when the user asks for an ongoing assistant. Home assistant relationship only, full access required. Supply a stable slug id, name and responsibility; retry with the same id. No project required. New Bots start with read-only Bara tools; the user adjusts permissions in Bot settings. Does not start a conversation or execution. Reuse an existing Bot for one-off tasks.",
    parameters: BotAssistantCreateInput,
    success: Schema.Struct({
      id: BotId,
      name: Schema.String,
      description: Schema.String,
      revision: Schema.Int,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      BotStore.BotStore,
      ThreadManagement.ThreadManagementService,
      McpInvocationContext.McpInvocationContext,
    ],
  }).annotate(Tool.Destructive, true),
  Tool.make("t3_bot_update", {
    description:
      "Edit a Bara teammate's name, responsibility, avatar, instructions or preferred model; use appendInstructions to preserve existing instructions with expectedRevision from t3_bot_list. Home relationship can edit teammates; a Bot relationship can edit itself. Requires full access. Cannot grant tools, alter resource permissions or change execution limits. A conflict keeps the saved configuration; refresh the revision and reconcile with the user.",
    parameters: BotAssistantUpdateInput,
    success: Schema.Struct({
      status: Schema.Literals(["saved", "conflict"]),
      id: BotId,
      revision: Schema.Int,
    }),
    failure: OrchestratorMcpFailure,
    failureMode: "return",
    dependencies: [
      BotStore.BotStore,
      ThreadManagement.ThreadManagementService,
      McpInvocationContext.McpInvocationContext,
    ],
  }).annotate(Tool.Destructive, true),
);
