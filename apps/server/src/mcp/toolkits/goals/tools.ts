import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  WorkspaceGoal,
  WorkspaceGoalSummary,
  WorkspaceGoalReadInput,
  WorkspaceGoalWriteInput,
  WorkspaceGoalWriteResult,
  WorkspaceGoalProgressInput,
  WorkspaceGoalHistoryInput,
  WorkspaceGoalHistory,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as WorkspaceGoals from "../../../workspace/WorkspaceGoals.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    WorkspaceGoals.WorkspaceGoals,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};

export const GoalsToolkit = Toolkit.make(
  Tool.make("t3_goals_list", {
    ...shared,
    description:
      "List the user's shared Bara goals and ongoing commitments, including status, next step and latest progress. Read a goal before changing it.",
    parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
    success: Schema.Array(WorkspaceGoalSummary),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_goals_read", {
    ...shared,
    description:
      "Read a Bara goal's context, Markdown plan, milestones, guidance and revision. Guidance records preferences, not an active schedule. To start requested check-ins, use schedule_task with this goalId and a concrete schedule. Tool permissions still apply.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspaceGoalReadInput.fields,
    }),
    success: Schema.NullOr(WorkspaceGoal),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_goals_history", {
    ...shared,
    description:
      "Read a Bara goal's progress history, newest first. Use nextBeforeSequence to request older entries. Entries distinguish user updates from agent updates.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspaceGoalHistoryInput.fields,
    }),
    success: WorkspaceGoalHistory,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_goals_write", {
    ...shared,
    description:
      "Save a Bara goal. Requires full access. Read first and preserve unrelated content. For a new goal use a new id and expectedRevision 0. On conflict reconcile with the returned goal and retry its revision; never overwrite concurrent edits blindly. Inactive goals suspend their linked check-ins without stopping running work or other scheduled jobs.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspaceGoalWriteInput.fields,
    }),
    success: WorkspaceGoalWriteResult,
  }).annotate(Tool.Destructive, true),
  Tool.make("t3_goals_progress", {
    ...shared,
    description:
      "Append a factual progress update to a Bara goal. Requires full access. Use a new updateId per entry and reuse it only to retry the same update. Recorded as an agent update with server time. Do not invent activity or promises of scheduled follow-up.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspaceGoalProgressInput.fields,
    }),
    success: Schema.NullOr(WorkspaceGoal),
  }).annotate(Tool.Destructive, false),
);
