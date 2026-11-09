import { describe, expect, it } from "vite-plus/test";
import type { WorkspacePage } from "@t3tools/contracts";
import {
  acceptPage,
  newPageDraft,
  pageHasConflict,
  pageIsDirty,
  pageRecoveryWorkspaces,
  receivePage,
} from "./pages";

const page: WorkspacePage = {
  id: "draft",
  content: { title: "Research", markdown: "# Original", source: null, archived: false },
  revision: 1,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
};
describe("Spaces draft reconciliation", () => {
  it("loads existing pages cleanly, preserves typing during saves and recognizes committed replies after reconnect", () => {
    const clean = acceptPage(undefined, page).drafts[page.id]!;
    expect(pageIsDirty(clean)).toBe(false);
    const submitted = { ...clean.content, title: "Renamed", markdown: "First edit" };
    const continued = {
      ...clean,
      content: { ...submitted, markdown: "First edit\nMore typing" },
      pendingContent: submitted,
    };
    const committed = { ...page, content: submitted, revision: 2 };
    const rebased = receivePage(continued, committed);
    expect(rebased.content.markdown).toBe(continued.content.markdown);
    expect(rebased.baseRevision).toBe(2);
    expect(pageHasConflict(rebased)).toBe(false);
    const final = receivePage(rebased, { ...committed, content: continued.content, revision: 3 });
    expect(pageIsDirty(final)).toBe(false);
    expect(receivePage(final, page)).toBe(final);
  });
  it("keeps competing agent changes and archives separate from local recovery edits", () => {
    const clean = acceptPage(undefined, page).drafts[page.id]!;
    const local = { ...clean, content: { ...clean.content, markdown: "My draft" } };
    const conflict = receivePage(local, {
      ...page,
      content: { ...page.content, archived: true },
      revision: 2,
    });
    expect(pageHasConflict(conflict)).toBe(true);
    expect(conflict.content.markdown).toBe("My draft");
    expect(conflict.remote?.content.archived).toBe(true);
    const recovery = pageRecoveryWorkspaces({
      host: { drafts: { clean, conflict, new: newPageDraft() } },
    });
    expect(Object.keys(recovery.host!.drafts).sort()).toEqual(["conflict", "new"]);
    expect(recovery.host!.drafts.conflict?.remote?.revision).toBe(2);
  });
});
