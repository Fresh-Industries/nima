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

type BotWorkMeta = {
  readonly coordinatorBotId?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly assistantWorkPending?: boolean | undefined;
  readonly workPending?: boolean | undefined;
};

/**
 * What a Bot is doing, from its own conversation and the Work it coordinates. Null means nothing
 * reliable is happening, so an idle Bot never shows a status it does not have.
 */
export function botActivity<
  T extends WorkStateInput & {
    readonly environmentId: string;
    readonly id: string;
    readonly title: string;
  },
>(input: {
  bot: { readonly id: string; readonly threadId: string | null };
  environmentId: string | null;
  threads: readonly T[];
  metaFor: (thread: T) => BotWorkMeta | undefined;
}): { state: "needs-you" | "working" | "queued"; text: string } | null {
  const own = input.threads.find(
    (thread) => thread.environmentId === input.environmentId && thread.id === input.bot.threadId,
  );
  if (own && threadNeedsYou(own)) return { state: "needs-you", text: needsYouReason(own) };
  for (const thread of input.threads) {
    const meta = input.metaFor(thread);
    if (
      meta?.coordinatorBotId === input.bot.id &&
      threadWorkState(thread, Boolean(meta.assistantWorkPending || meta.workPending)) === "working"
    )
      return { state: "working", text: `Working on ${meta.title || thread.title}` };
  }
  const state = own ? threadWorkState(own) : null;
  if (state === "working") return { state, text: "Working" };
  if (state === "queued") return { state, text: "Queued" };
  return null;
}
