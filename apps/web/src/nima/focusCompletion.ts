import type { NodeId, OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";

export function focusCardItemId(
  projection: OrchestrationV2ThreadProjection | undefined,
  taskId: NodeId,
) {
  if (!projection) return null;
  const task = projection.subagents.find(
    (agent) => agent.id === taskId && agent.origin === "app_owned",
  );
  const items = projection.visibleTurnItems;
  const launch = items.find(
    ({ item }) =>
      item.type === "subagent" && item.origin === "app_owned" && item.subagentId === taskId,
  );
  if (launch) return launch.item.id;
  const created = task?.childThreadId
    ? items.find(
        ({ item }) => item.type === "thread_created" && item.targetThreadId === task.childThreadId,
      )
    : undefined;
  if (created) return created.item.id;
  if (!task || !(task.childThreadId || task.remoteChild?.threadId)) return null;
  return (
    items.find(
      ({ item }) =>
        item.type === "notification" &&
        item.source.kind === "delegated_task" &&
        item.source.taskIds.includes(taskId),
    )?.item.id ?? null
  );
}

export function focusCompletion(
  projection: OrchestrationV2ThreadProjection | undefined,
  runId: RunId | null,
) {
  if (!projection || !runId) return null;
  const run = projection.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;
  const trigger = projection.messages.find((message) => message.id === run.userMessageId);
  if (trigger) {
    if (trigger.delegatedCompletion)
      return { kind: "delegated_task" as const, taskIds: trigger.delegatedCompletion.taskIds };
    return trigger.notification?.source.kind === "delegated_task"
      ? trigger.notification.source
      : null;
  }
  const delivery = projection.runs.find(
    (candidate) => candidate.delegatedCompletion?.delivery?.messageId === run.userMessageId,
  )?.delegatedCompletion?.delivery;
  return delivery ? { kind: "delegated_task" as const, taskIds: delivery.taskIds } : null;
}
