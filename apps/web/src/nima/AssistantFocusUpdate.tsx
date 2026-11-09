import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { NodeId, ScopedThreadRef } from "@t3tools/contracts";
import { environmentThreadDetails } from "../state/threads";
import { focusCardItemId } from "./focusCompletion";

export function AssistantFocusUpdate({
  parentRef,
  taskIds,
}: {
  parentRef: ScopedThreadRef;
  taskIds: readonly NodeId[];
}) {
  const projection = useAtomValue(
    environmentThreadDetails.threadAtom(parentRef),
    (thread) => thread?.projection,
  );
  const uncovered = taskIds.filter((id) => !focusCardItemId(projection, id));
  const sessions = uncovered.flatMap((id) => {
    const task = projection?.subagents.find(
      (agent) => agent.id === id && agent.origin === "app_owned",
    );
    const threadId = task?.remoteChild?.threadId ?? task?.childThreadId;
    return task && threadId
      ? [
          {
            taskId: task.id,
            threadId,
            environmentId: task.remoteChild?.environmentId ?? parentRef.environmentId,
            title: task.title || "Focus Session",
          },
        ]
      : [];
  });
  if (!uncovered.length) return null;
  return (
    <section aria-label="Focus Session update" className="space-y-2 px-1 py-2 text-sm">
      <p className="text-muted-foreground">
        Your Focus Session has an update. The full result stays in its conversation.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {sessions.map((session) => (
          <Link
            key={session.taskId}
            to="/$environmentId/$threadId"
            params={{ environmentId: session.environmentId, threadId: session.threadId }}
            className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Open {session.title} →
          </Link>
        ))}
        {!sessions.length ? (
          <Link
            to="/inbox"
            className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Review in Inbox →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
