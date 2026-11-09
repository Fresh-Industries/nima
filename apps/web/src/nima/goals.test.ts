import { describe, expect, it } from "vite-plus/test";
import type { WorkspaceGoal } from "@t3tools/contracts";
import {
  createGoalDraft,
  goalHasConflict,
  goalIsDirty,
  newGoalContent,
  receiveGoal,
  receiveGoals,
} from "./goals";

const base: WorkspaceGoal = {
  id: "guide",
  content: newGoalContent("Write the guide"),
  revision: 1,
  createdAt: "2026-11-03T12:00:00Z",
  updatedAt: "2026-11-03T12:00:00Z",
  latestUpdate: null,
};
const clean = () => receiveGoal(createGoalDraft(base.content), base);

describe("goal recovery drafts", () => {
  it("imports browser goals once without overwriting a colliding server goal", () => {
    const legacy = [
      {
        id: "guide",
        title: "My browser goal",
        milestones: [{ id: "draft", title: "Draft", done: true }],
      },
    ];
    const imported = receiveGoals(undefined, { goals: [] }, legacy);
    expect(imported.drafts.guide?.content.milestones[0]?.done).toBe(true);
    expect(goalIsDirty(imported.drafts.guide!)).toBe(true);
    const conflicted = receiveGoals(undefined, { goals: [base] }, legacy);
    expect(conflicted.drafts.guide?.content.title).toBe("My browser goal");
    expect(goalHasConflict(conflicted.drafts.guide!)).toBe(true);
    const saved = receiveGoals(
      imported,
      { goals: [{ ...base, content: { ...imported.drafts.guide!.content, status: "archived" } }] },
      legacy,
    );
    const restored = receiveGoals(saved, { goals: [] }, [
      { id: "other", title: "Should not be imported again", milestones: [] },
    ]);
    expect(restored.drafts.other).toBeUndefined();
    expect(restored.drafts.guide).toEqual(saved.drafts.guide);
  });

  it("preserves edits typed during a save and recognizes a commit whose response was lost", () => {
    const submitted = { ...base.content, plan: "# First edit" };
    const draft = {
      ...clean(),
      content: { ...submitted, plan: "# First edit\n\nMore while saving" },
      pendingContent: submitted,
    };
    const committed = { ...base, content: submitted, revision: 2 };
    const rebased = receiveGoal(draft, committed);
    expect(rebased.content.plan).toBe(draft.content.plan);
    expect(rebased.baseRevision).toBe(2);
    expect(goalHasConflict(rebased)).toBe(false);
    expect(goalIsDirty(rebased)).toBe(true);
    const final = receiveGoal(rebased, { ...committed, content: rebased.content, revision: 3 });
    expect(goalIsDirty(final)).toBe(false);
    expect(receiveGoal(final, committed)).toBe(final);
    const completion = { ...base.content, status: "completed" as const };
    const reopenedDuringSave = { ...clean(), content: base.content, pendingContent: completion };
    expect(goalIsDirty(reopenedDuringSave)).toBe(true);
    const beforeAck = receiveGoal(reopenedDuringSave, base);
    expect(beforeAck.pendingContent).toEqual(completion);
    const afterAck = receiveGoal(beforeAck, { ...base, content: completion, revision: 2 });
    expect(afterAck.content.status).toBe("active");
    expect(afterAck.baseContent?.status).toBe("completed");
    expect(goalIsDirty(afterAck)).toBe(true);
    expect(goalHasConflict(afterAck)).toBe(false);
  });

  it("rebases progress-only revisions but keeps both versions of competing plan edits", () => {
    const draft = { ...clean(), content: { ...base.content, plan: "My plan" } };
    const progress = {
      ...base,
      revision: 2,
      latestUpdate: {
        id: "progress",
        sequence: 1,
        text: "Outline written",
        source: "agent" as const,
        createdAt: base.updatedAt,
      },
    };
    const rebased = receiveGoal(draft, progress);
    expect(rebased.baseRevision).toBe(2);
    expect(rebased.content.plan).toBe("My plan");
    expect(goalHasConflict(rebased)).toBe(false);
    const competing = {
      ...progress,
      revision: 3,
      content: { ...base.content, plan: "Another browser’s plan" },
    };
    const conflict = receiveGoal(rebased, competing);
    expect(conflict.content.plan).toBe("My plan");
    expect(conflict.remote?.content.plan).toBe("Another browser’s plan");
    expect(goalHasConflict(conflict)).toBe(true);
    expect(receiveGoal(conflict, progress)).toBe(conflict);
    expect(receiveGoal(clean(), competing).content.plan).toBe(competing.content.plan);
  });
});
