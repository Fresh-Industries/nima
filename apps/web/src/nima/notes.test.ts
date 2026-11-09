import { describe, expect, it } from "vite-plus/test";
import { createNoteDraft, noteHasConflict, noteIsDirty, receiveNote } from "./notes";

describe("workspace note reconciliation", () => {
  it("imports existing browser notes into an empty server without overwriting an existing server note", () => {
    const legacy = createNoteDraft("# My local notes");
    const empty = { markdown: "", revision: 0, updatedAt: null };
    expect(receiveNote(legacy, empty)).toEqual(legacy);
    expect(noteIsDirty(legacy)).toBe(true);
    const existing = {
      markdown: "# Saved elsewhere",
      revision: 3,
      updatedAt: "2026-11-03T12:00:00Z",
    };
    expect(receiveNote(legacy, existing)).toEqual(legacy);
    expect(noteHasConflict(legacy, existing)).toBe(true);
    expect(receiveNote(createNoteDraft(), existing)).toEqual({
      markdown: existing.markdown,
      baseMarkdown: existing.markdown,
      baseRevision: 3,
      pendingMarkdown: null,
    });
  });

  it("keeps edits typed during a save, including a committed save whose reply was lost", () => {
    const base = { ...createNoteDraft(), markdown: "First edit", pendingMarkdown: "First edit" };
    const continued = { ...base, markdown: "First edit\nSecond edit while saving" };
    const committed = { markdown: "First edit", revision: 1, updatedAt: "2026-11-03T12:00:00Z" };
    const rebased = receiveNote(continued, committed);
    expect(rebased.markdown).toBe(continued.markdown);
    expect(rebased.baseRevision).toBe(1);
    expect(noteHasConflict(rebased, committed)).toBe(false);
    expect(noteIsDirty(rebased)).toBe(true);
    const final = receiveNote(rebased, { ...committed, markdown: continued.markdown, revision: 2 });
    expect(noteIsDirty(final)).toBe(false);
    expect(receiveNote(final, committed)).toBe(final);
  });

  it("accepts remote edits only when the local draft is clean or matches the saved content", () => {
    const clean = receiveNote(createNoteDraft(), {
      markdown: "base",
      revision: 1,
      updatedAt: null,
    });
    const dirty = { ...clean, markdown: "my edit" };
    const other = { markdown: "another browser's edit", revision: 2, updatedAt: null };
    expect(receiveNote(dirty, other)).toBe(dirty);
    expect(noteHasConflict(dirty, other)).toBe(true);
    expect(receiveNote(clean, other).markdown).toBe(other.markdown);
    const identical = { ...other, markdown: dirty.markdown };
    expect(noteIsDirty(receiveNote(dirty, identical))).toBe(false);
  });
});
