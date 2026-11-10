import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

export type WorkState = "needs-you" | "working" | "queued" | "stopped" | "ready";

type WorkStateInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "hasActionableProposedPlan"
  | "pendingSubagentRequest"
  | "runtime"
  | "latestRun"
  | "pendingBackgroundTasks"
>;

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  "needs-you": "Needs you",
  working: "Working",
  queued: "Queued",
  stopped: "Stopped",
  ready: "Ready",
};

export function threadNeedsYou(thread: WorkStateInput): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.hasActionableProposedPlan ||
    thread.pendingSubagentRequest != null
  );
}

export function needsYouReason(thread: WorkStateInput): string {
  if (thread.hasPendingApprovals) return "Approval needed";
  if (thread.hasPendingUserInput) return "Question for you";
  if (thread.hasActionableProposedPlan) return "Plan ready to review";
  if (thread.pendingSubagentRequest === "approval") return "A helper agent needs approval";
  return "A helper agent has a question";
}

/** `backgroundPending` carries Bara review metadata that the shell cannot see. */
export function threadWorkState(thread: WorkStateInput, backgroundPending = false): WorkState {
  if (threadNeedsYou(thread)) return "needs-you";
  if (thread.runtime?.status === "queued") return "queued";
  if (
    threadRuntimeIsActive(thread.runtime) ||
    backgroundPending ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)
  )
    return "working";
  const status = thread.latestRun?.status;
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "stopped";
  return "ready";
}
