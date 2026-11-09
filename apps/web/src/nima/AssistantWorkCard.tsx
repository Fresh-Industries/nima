import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { NodeId, ThreadId, TurnItemId, ScopedThreadRef } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { useThreadShell } from "../state/entities";
import { useEnvironment } from "../state/environments";
import { environmentThreadDetails } from "../state/threads";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { focusCardItemId } from "./focusCompletion";

/** Follow T3's persisted task and shell streams; reading a card never acknowledges a task result. */
export function AssistantWorkCard({
  parentRef,
  taskId,
  itemId,
  threadId,
  title,
  fallback,
}: {
  parentRef: ScopedThreadRef;
  taskId?: NodeId | undefined;
  itemId?: TurnItemId | undefined;
  threadId?: ThreadId | undefined;
  title?: string | null | undefined;
  fallback: ReactNode;
}) {
  const task = useAtomValue(
    environmentThreadDetails.threadAtom(parentRef),
    (thread) =>
      thread?.projection.subagents.find(
        (agent) =>
          agent.origin === "app_owned" &&
          (taskId ? agent.id === taskId : threadId && agent.childThreadId === threadId),
      ) ?? null,
  );
  const targetId = task?.remoteChild?.threadId ?? task?.childThreadId ?? threadId;
  const environmentId = task?.remoteChild?.environmentId ?? parentRef.environmentId;
  const target = targetId ? scopeThreadRef(environmentId, targetId) : null;
  const child = useThreadShell(target);
  const environment = useEnvironment(environmentId);
  const review = useWorkspaceReview();
  const representedBy = useAtomValue(environmentThreadDetails.threadAtom(parentRef), (thread) =>
    task ? focusCardItemId(thread?.projection, task.id) : null,
  );
  const meta = target ? review.metadata.get(scopedThreadKey(target)) : undefined;
  const result = review.items.find(
    (item) => item.environmentId === environmentId && item.threadId === targetId,
  );
  if (itemId && representedBy && representedBy !== itemId) return null;
  if (!target || (!task && !child)) return fallback;
  const needsApproval = Boolean(child?.hasPendingApprovals);
  const needsReply = Boolean(
    child?.hasPendingUserInput || child?.hasActionableProposedPlan || child?.pendingSubagentRequest,
  );
  const background = Boolean(
    meta?.assistantWorkPending ||
    (child && backgroundWorkHoldsCompletion(child.pendingBackgroundTasks)),
  );
  const running =
    Boolean(child && threadRuntimeIsActive(child.runtime)) ||
    background ||
    task?.status === "running" ||
    task?.status === "pending";
  const status = child?.latestRun?.status ?? task?.status;
  const finished =
    !running &&
    !needsApproval &&
    !needsReply &&
    ["completed", "failed", "cancelled", "interrupted"].includes(status ?? "");
  const label = needsApproval
    ? "Approval needed"
    : needsReply
      ? "Needs your input"
      : running
        ? child?.runtime?.status === "queued" || task?.status === "pending"
          ? "Queued"
          : "Working"
        : status === "waiting"
          ? "Waiting"
          : status === "failed"
            ? "Needs attention"
            : status === "cancelled" || status === "interrupted"
              ? "Stopped"
              : finished
                ? meta?.state === "settled"
                  ? "Reviewed"
                  : "Ready to review"
                : "Session open";
  const summary = finished ? (task?.result ?? result?.summary) : task?.progress;
  const sessionTitle = child?.title ?? task?.title ?? title ?? "Focus session";
  return (
    <section
      aria-label={`Work session: ${sessionTitle}`}
      className="my-2 min-w-0 space-y-3 rounded-xl border border-border/60 bg-muted/10 p-4 text-sm"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Layers size={14} aria-hidden />
        <span>Focus session</span>
        <span aria-hidden>·</span>
        <span>{label}</span>
      </div>
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId, threadId: target.threadId }}
        className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {sessionTitle}
      </Link>
      {summary ? (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {summary.slice(0, 600)}
        </p>
      ) : null}
      {task?.remoteChild ? (
        <p className="text-xs text-muted-foreground">{task.remoteChild.label}</p>
      ) : null}
      {environment?.connection.phase !== "connected" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Last known status. Reconnect to receive updates.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: target.threadId }}
            />
          }
        >
          {needsApproval || needsReply
            ? "Review request"
            : finished
              ? "Open result"
              : "Open conversation"}
        </Button>
        {result ? (
          <Button size="xs" variant="ghost" render={<Link to="/inbox" />}>
            Review in Inbox
          </Button>
        ) : null}
      </div>
    </section>
  );
}
