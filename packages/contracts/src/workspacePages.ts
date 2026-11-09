import * as Schema from "effect/Schema";
import { IsoDateTime, RunId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { WorkspaceNoteMarkdown } from "./workspaceNotes.ts";

export const WorkspacePageId = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
export const WorkspacePageSource = Schema.Struct({ threadId: ThreadId, runId: RunId });
export const WorkspacePageContent = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  markdown: WorkspaceNoteMarkdown,
  archived: Schema.Boolean,
  source: Schema.NullOr(WorkspacePageSource),
});
export type WorkspacePageContent = typeof WorkspacePageContent.Type;
export const WorkspacePage = Schema.Struct({
  id: WorkspacePageId,
  content: WorkspacePageContent,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspacePage = typeof WorkspacePage.Type;
export const WorkspacePageSummary = Schema.Struct({
  id: WorkspacePageId,
  title: WorkspacePageContent.fields.title,
  archived: Schema.Boolean,
  excerpt: Schema.String,
  revision: WorkspacePage.fields.revision,
  updatedAt: IsoDateTime,
  source: Schema.NullOr(WorkspacePageSource),
});
export type WorkspacePageSummary = typeof WorkspacePageSummary.Type;
export const WorkspacePageCursor = Schema.Struct({ at: IsoDateTime, id: WorkspacePageId });
export type WorkspacePageCursor = typeof WorkspacePageCursor.Type;
export const WorkspacePagesListInput = Schema.Struct({
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
  archived: Schema.optional(Schema.Boolean),
  before: Schema.optional(WorkspacePageCursor),
});
export type WorkspacePagesListInput = typeof WorkspacePagesListInput.Type;
export const WorkspacePagesList = Schema.Struct({
  pages: Schema.Array(WorkspacePageSummary),
  nextCursor: Schema.NullOr(WorkspacePageCursor),
});
export type WorkspacePagesList = typeof WorkspacePagesList.Type;
export const WorkspacePageReadInput = Schema.Struct({ id: WorkspacePageId });
export const WorkspacePagesSubscribeInput = Schema.Struct({
  ...WorkspacePagesListInput.fields,
  id: Schema.optional(WorkspacePageId),
});
export type WorkspacePagesSubscribeInput = typeof WorkspacePagesSubscribeInput.Type;
export const WorkspacePagesSnapshot = Schema.Struct({
  ...WorkspacePagesList.fields,
  page: Schema.NullOr(WorkspacePage),
});
export type WorkspacePagesSnapshot = typeof WorkspacePagesSnapshot.Type;
export const WorkspacePageWriteInput = Schema.Struct({
  id: WorkspacePageId,
  content: WorkspacePageContent,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type WorkspacePageWriteInput = typeof WorkspacePageWriteInput.Type;
export const WorkspacePageWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  page: Schema.NullOr(WorkspacePage),
});
export type WorkspacePageWriteResult = typeof WorkspacePageWriteResult.Type;
export const WorkspacePageCaptureInput = Schema.Struct({
  id: WorkspacePageId,
  ...WorkspacePageSource.fields,
  title: Schema.optional(WorkspacePageContent.fields.title),
});
export type WorkspacePageCaptureInput = typeof WorkspacePageCaptureInput.Type;
export class WorkspacePageError extends Schema.TaggedError<WorkspacePageError>()(
  "WorkspacePageError",
  {
    reason: Schema.Literals(["read", "write", "unavailable", "too_large"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.reason === "unavailable"
      ? "No completed text result is available to save. Open the conversation to inspect its output."
      : this.reason === "too_large"
        ? "This result is too large for one page. Open the conversation and save a smaller section."
        : this.reason === "read"
          ? "Could not load Spaces."
          : "Could not save this page.";
  }
}
