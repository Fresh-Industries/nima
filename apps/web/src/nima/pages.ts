import { WorkspacePageContent, type WorkspacePage } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type PageDraft = {
  content: WorkspacePageContent;
  baseContent: WorkspacePageContent | null;
  baseRevision: number;
  pendingContent: WorkspacePageContent | null;
  remote: WorkspacePage | null;
};
export type PageWorkspace = { drafts: Record<string, PageDraft> };
export const validPageContent = Schema.is(WorkspacePageContent);
export function newPageDraft(): PageDraft {
  return {
    content: { title: "Untitled", markdown: "", archived: false, source: null },
    baseContent: null,
    baseRevision: 0,
    pendingContent: null,
    remote: null,
  };
}
function sameContent(a: WorkspacePageContent | null, b: WorkspacePageContent | null) {
  return (
    a === b ||
    Boolean(
      a &&
      b &&
      a.title.trim() === b.title.trim() &&
      a.markdown === b.markdown &&
      a.archived === b.archived &&
      a.source?.threadId === b.source?.threadId &&
      a.source?.runId === b.source?.runId,
    )
  );
}
export function pageIsDirty(draft: PageDraft) {
  return !sameContent(draft.content, draft.baseContent);
}
export function pageHasConflict(draft: PageDraft) {
  return (
    pageIsDirty(draft) &&
    draft.remote !== null &&
    draft.remote.revision > draft.baseRevision &&
    !sameContent(draft.remote.content, draft.content) &&
    !sameContent(draft.remote.content, draft.baseContent) &&
    !sameContent(draft.remote.content, draft.pendingContent)
  );
}
export function receivePage(draft: PageDraft, page: WorkspacePage): PageDraft {
  if (page.revision < Math.max(draft.baseRevision, draft.remote?.revision ?? 0)) return draft;
  if (pageHasConflict({ ...draft, remote: page })) return { ...draft, remote: page };
  if (draft.remote?.revision === page.revision && sameContent(draft.remote.content, page.content))
    return draft;
  return {
    ...draft,
    content:
      pageIsDirty(draft) && !sameContent(draft.content, page.content)
        ? draft.content
        : page.content,
    baseContent: page.content,
    baseRevision: page.revision,
    pendingContent: null,
    remote: page,
  };
}
export function acceptPage(
  workspace: PageWorkspace | undefined,
  page: WorkspacePage,
): PageWorkspace {
  return {
    drafts: {
      ...workspace?.drafts,
      [page.id]: receivePage(
        workspace?.drafts[page.id] ?? { ...newPageDraft(), content: page.content },
        page,
      ),
    },
  };
}

export function pageRecoveryWorkspaces(workspaces: Record<string, PageWorkspace>) {
  return Object.fromEntries(
    Object.entries(workspaces).map(([host, workspace]) => [
      host,
      {
        drafts: Object.fromEntries(
          Object.entries(workspace.drafts).filter(
            ([, draft]) => pageIsDirty(draft) || draft.pendingContent !== null,
          ),
        ),
      },
    ]),
  );
}
