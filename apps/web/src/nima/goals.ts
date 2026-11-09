import {
  WorkspaceGoalContent,
  type WorkspaceGoal,
  type WorkspaceGoalsSnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

function textOf(node: Nodes): string {
  if (node.type === "html") return "";
  if ("value" in node) return node.value;
  return "children" in node ? node.children.map(textOf).join(node.type === "root" ? " " : "") : "";
}

export function goalSummary(draft: GoalDraft): string {
  const text = draft.remote?.latestUpdate?.text || draft.content.nextStep || draft.content.context;
  return textOf(fromMarkdown(text)).replace(/\s+/g, " ").trim();
}

export type GoalDraft = {
  content: WorkspaceGoalContent;
  baseContent: WorkspaceGoalContent | null;
  baseRevision: number;
  pendingContent: WorkspaceGoalContent | null;
  remote: WorkspaceGoal | null;
  progressText: string;
  progressId: string;
  pendingProgress: { id: string; text: string } | null;
};
export type GoalWorkspace = { drafts: Record<string, GoalDraft> };
export const validGoalContent = Schema.is(WorkspaceGoalContent);

export function newGoalContent(title: string): WorkspaceGoalContent {
  return {
    title,
    kind: "goal",
    status: "active",
    context: "",
    targetDate: null,
    plan: "",
    nextStep: "",
    milestones: [],
    guidance: { cadence: "when-useful", instructions: "" },
  };
}
export function createGoalDraft(content: WorkspaceGoalContent): GoalDraft {
  return {
    content,
    baseContent: null,
    baseRevision: 0,
    pendingContent: null,
    remote: null,
    progressText: "",
    progressId: "",
    pendingProgress: null,
  };
}
function sameGoalContent(a: WorkspaceGoalContent | null, b: WorkspaceGoalContent | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function goalIsDirty(draft: GoalDraft) {
  // Returning to the base is still an edit when a different value is being saved.
  return (
    !sameGoalContent(draft.content, draft.baseContent) ||
    (draft.pendingContent !== null && !sameGoalContent(draft.content, draft.pendingContent))
  );
}
export function goalHasConflict(draft: GoalDraft) {
  return (
    goalIsDirty(draft) &&
    draft.remote !== null &&
    draft.remote.revision > draft.baseRevision &&
    !sameGoalContent(draft.remote.content, draft.content) &&
    !sameGoalContent(draft.remote.content, draft.baseContent) &&
    !sameGoalContent(draft.remote.content, draft.pendingContent)
  );
}
export function receiveGoal(draft: GoalDraft, goal: WorkspaceGoal): GoalDraft {
  if (goal.revision < Math.max(draft.baseRevision, draft.remote?.revision ?? 0)) return draft;
  if (goalHasConflict({ ...draft, remote: goal })) return { ...draft, remote: goal };
  return {
    ...draft,
    content: goalIsDirty(draft) ? draft.content : goal.content,
    baseContent: goal.content,
    baseRevision: goal.revision,
    pendingContent:
      goal.revision === draft.baseRevision && !sameGoalContent(goal.content, draft.pendingContent)
        ? draft.pendingContent
        : null,
    remote: goal,
  };
}

export function receiveGoals(
  previous: GoalWorkspace | undefined,
  snapshot: WorkspaceGoalsSnapshot,
  legacy: ReadonlyArray<{
    id: string;
    title: string;
    milestones: WorkspaceGoalContent["milestones"];
  }> = [],
): GoalWorkspace {
  const drafts = { ...previous?.drafts };
  if (!previous)
    for (const goal of legacy) {
      drafts[goal.id] = createGoalDraft({
        ...newGoalContent(goal.title),
        milestones: goal.milestones,
      });
    }
  for (const goal of snapshot.goals)
    drafts[goal.id] = receiveGoal(drafts[goal.id] ?? createGoalDraft(goal.content), goal);
  return { drafts };
}
