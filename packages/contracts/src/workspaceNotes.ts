import * as Schema from "effect/Schema";

export const WORKSPACE_NOTE_MAX_LENGTH = 200_000;
export const WorkspaceNoteMarkdown = Schema.String.check(
  Schema.isMaxLength(WORKSPACE_NOTE_MAX_LENGTH),
);
export const WorkspaceNote = Schema.Struct({
  markdown: WorkspaceNoteMarkdown,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: Schema.NullOr(Schema.String),
});
export type WorkspaceNote = typeof WorkspaceNote.Type;

export const WorkspaceNoteWriteInput = Schema.Struct({
  markdown: WorkspaceNoteMarkdown,
  expectedRevision: WorkspaceNote.fields.revision,
});
export type WorkspaceNoteWriteInput = typeof WorkspaceNoteWriteInput.Type;

export const WorkspaceNoteWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  note: WorkspaceNote,
});
export type WorkspaceNoteWriteResult = typeof WorkspaceNoteWriteResult.Type;

export class WorkspaceNoteError extends Schema.TaggedError<WorkspaceNoteError>()(
  "WorkspaceNoteError",
  { operation: Schema.Literals(["read", "write"]), cause: Schema.Defect() },
) {
  override get message() {
    return this.operation === "read"
      ? "Could not load workspace notes."
      : "Could not save workspace notes.";
  }
}
