import type { WorkspaceNote } from "@t3tools/contracts";

export type NoteDraft = {
  markdown: string;
  baseMarkdown: string;
  baseRevision: number;
  pendingMarkdown: string | null;
};

export function createNoteDraft(legacyMarkdown = ""): NoteDraft {
  return { markdown: legacyMarkdown, baseMarkdown: "", baseRevision: 0, pendingMarkdown: null };
}

export function noteIsDirty(draft: NoteDraft): boolean {
  return draft.markdown !== draft.baseMarkdown;
}

export function receiveNote(draft: NoteDraft, note: WorkspaceNote): NoteDraft {
  if (note.revision < draft.baseRevision) return draft;
  if (note.revision === draft.baseRevision && note.markdown === draft.baseMarkdown) return draft;
  if (
    !noteIsDirty(draft) ||
    note.markdown === draft.markdown ||
    note.markdown === draft.baseMarkdown ||
    note.markdown === draft.pendingMarkdown
  ) {
    return {
      markdown: noteIsDirty(draft) ? draft.markdown : note.markdown,
      baseMarkdown: note.markdown,
      baseRevision: note.revision,
      pendingMarkdown: null,
    };
  }
  return draft;
}

export function noteHasConflict(draft: NoteDraft, note: WorkspaceNote | null): boolean {
  return (
    note !== null &&
    note.revision > draft.baseRevision &&
    note.markdown !== draft.markdown &&
    note.markdown !== draft.baseMarkdown &&
    note.markdown !== draft.pendingMarkdown
  );
}
