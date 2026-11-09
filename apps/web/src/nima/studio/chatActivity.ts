import type {
  EnvironmentId,
  OrchestrationV2TurnItemStatus,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";
import { compactDynamicToolOutput } from "@t3tools/shared/toolOutput";
import {
  readT3ToolInput,
  t3ToolResultIndicatesFailure,
} from "@t3tools/client-runtime/t3ToolSummary";

type ActivityItem = {
  sourceThreadId: ThreadId;
  item: {
    type: string;
    runId: RunId | null;
    status: OrchestrationV2TurnItemStatus;
    toolName?: string | null;
    input?: unknown;
    output?: unknown;
  };
};

export function studioChatActivity(
  rows: readonly ActivityItem[],
  target: {
    environmentId: EnvironmentId;
    threadId: ThreadId;
    runId: RunId | null;
    assetId: string;
    revision: number;
  },
): string | null {
  if (!target.runId) return null;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    const item = row.item;
    if (
      row.sourceThreadId !== target.threadId ||
      item.runId !== target.runId ||
      item.type !== "dynamic_tool"
    )
      continue;
    const tool = resolveT3McpToolId(item.toolName);
    if (tool !== "t3_studio_inspect" && tool !== "t3_studio_edit") continue;
    const input = readT3ToolInput(item.input);
    if (
      !input ||
      input.id !== target.assetId ||
      (input.environmentId !== undefined && input.environmentId !== target.environmentId)
    )
      continue;
    if (tool === "t3_studio_inspect" && input.scope !== "artwork") continue;
    if (
      tool === "t3_studio_edit" &&
      input.operation !== "artwork" &&
      input.operation !== "photo_crop"
    )
      continue;
    if (item.status === "failed" || t3ToolResultIndicatesFailure(item.output))
      return tool === "t3_studio_edit"
        ? "Chat edit failed · see conversation"
        : "Could not read artwork · see conversation";
    if (item.status === "waiting") return "Waiting on chat…";
    if (item.status === "pending" || item.status === "running")
      return tool === "t3_studio_edit" ? "Editing from chat…" : "Reading artwork…";
    if (item.status === "cancelled" || item.status === "interrupted")
      return "Studio activity stopped";
    if (tool === "t3_studio_inspect") continue;
    const receipt = compactDynamicToolOutput(item.output);
    const revision = receipt?.current_revision;
    if (
      item.status !== "completed" ||
      typeof revision !== "number" ||
      typeof input.expectedRevision !== "number" ||
      revision <= input.expectedRevision
    )
      return null;
    if (target.revision < revision) return "Updating canvas…";
    return target.revision === revision ? "Updated from chat" : null;
  }
  return null;
}
