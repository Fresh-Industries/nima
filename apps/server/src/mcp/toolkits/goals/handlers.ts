import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as WorkspaceGoals from "../../../workspace/WorkspaceGoals.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { GoalsToolkit } from "./tools.ts";

const failure = (cause: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: cause.message });

export const layer = McpToolAccess.toLayer(GoalsToolkit, {
  t3_goals_list: McpToolAccess.reads(() =>
    Effect.flatMap(WorkspaceGoals.WorkspaceGoals, (goals) =>
      goals.summaries().pipe(Effect.mapError(failure)),
    ),
  ),
  t3_goals_read: McpToolAccess.reads((input) =>
    Effect.flatMap(WorkspaceGoals.WorkspaceGoals, (goals) =>
      goals.read(input).pipe(Effect.mapError(failure)),
    ),
  ),
  t3_goals_history: McpToolAccess.reads((input) =>
    Effect.flatMap(WorkspaceGoals.WorkspaceGoals, (goals) =>
      goals.history(input).pipe(Effect.mapError(failure)),
    ),
  ),
  t3_goals_write: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(WorkspaceGoals.WorkspaceGoals, (goals) =>
      goals.write(input).pipe(Effect.mapError(failure)),
    ),
  ),
  t3_goals_progress: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(WorkspaceGoals.WorkspaceGoals, (goals) =>
      goals.addProgress(input, "agent").pipe(Effect.mapError(failure)),
    ),
  ),
});
