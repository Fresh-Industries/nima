import { BotId } from "./bots.ts";
import { ProjectId } from "./baseSchemas.ts";
import { WorkspaceGoalId } from "./workspaceGoals.ts";
import * as Schema from "effect/Schema";
import {
  IsoDateTime,
  RunId,
  ScheduledTaskId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const WorkspaceReviewState = Schema.Literals(["review", "settled", "active"]);
export const WorkspaceReviewCursor = Schema.Struct({ at: IsoDateTime, key: TrimmedNonEmptyString });
export type WorkspaceReviewCursor = typeof WorkspaceReviewCursor.Type;
export const WorkspaceReviewItem = Schema.Struct({
  key: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  kind: Schema.Literals(["focus", "bot"]),
  threadId: ThreadId,
  runId: Schema.NullOr(RunId),
  botId: Schema.NullOr(ScheduledTaskId),
  goalId: Schema.optional(Schema.NullOr(WorkspaceGoalId)),
  title: Schema.String,
  summary: Schema.String,
  completedAt: IsoDateTime,
  status: Schema.NullOr(Schema.String),
  state: WorkspaceReviewState,
});
export type WorkspaceReviewItem = typeof WorkspaceReviewItem.Type;
export const WorkspaceThreadMetadata = Schema.Struct({
  threadId: ThreadId,
  assistantWork: Schema.optional(Schema.Boolean),
  assistantWorkPending: Schema.optional(Schema.Boolean),
  kind: Schema.NullOr(Schema.Literals(["focus", "assistant"])),
  title: Schema.NullOr(Schema.String),
  objective: Schema.NullOr(Schema.String),
  state: Schema.NullOr(WorkspaceReviewState),
  version: Schema.NullOr(Schema.String),
  latestRunIsBot: Schema.Boolean,
  coordinatorBotId: Schema.optional(Schema.NullOr(BotId)),
  scopeProjectId: Schema.optional(Schema.NullOr(ProjectId)),
  configurationRevision: Schema.optional(Schema.Int),
  workPending: Schema.optional(Schema.Boolean),
});
export type WorkspaceThreadMetadata = typeof WorkspaceThreadMetadata.Type;
export const WorkspaceReviewReadInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(1000)),
  view: Schema.Literals(["review", "settled"]),
  before: Schema.optional(WorkspaceReviewCursor),
});
export type WorkspaceReviewReadInput = typeof WorkspaceReviewReadInput.Type;
export const WorkspaceReviewSnapshot = Schema.Struct({
  metadata: Schema.Array(WorkspaceThreadMetadata),
  items: Schema.Array(WorkspaceReviewItem),
  pendingCount: Schema.Int,
  nextCursor: Schema.NullOr(WorkspaceReviewCursor),
});
export type WorkspaceReviewSnapshot = typeof WorkspaceReviewSnapshot.Type;
export const WorkspaceReviewWriteInput = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("coordinate"),
    threadId: ThreadId,
    coordinatorBotId: Schema.NullOr(BotId),
    expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    action: Schema.Literal("remember"),
    threadId: ThreadId,
    kind: Schema.Literals(["focus", "assistant"]),
    title: Schema.String.check(Schema.isMaxLength(240)),
    objective: Schema.String.check(Schema.isMaxLength(20000)),
    review: Schema.Boolean,
  }),
  Schema.Struct({ action: Schema.Literal("request"), threadId: ThreadId }),
  Schema.Struct({
    action: Schema.Literals(["settle", "reopen"]),
    key: TrimmedNonEmptyString,
    version: TrimmedNonEmptyString,
  }),
]);
export type WorkspaceReviewWriteInput = typeof WorkspaceReviewWriteInput.Type;
export class WorkspaceReviewError extends Schema.TaggedError<WorkspaceReviewError>()(
  "WorkspaceReviewError",
  {
    reason: Schema.Literals([
      "unavailable",
      "changed",
      "read",
      "write",
      "busy",
      "configuration-changed",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.reason === "configuration-changed"
      ? "The coordinator changed elsewhere. Reload the session before saving."
      : this.reason === "busy"
        ? "Wait for the current run and its background tasks to finish before updating this session."
        : this.reason === "changed"
          ? "New results arrived. Review them before settling this item."
          : this.reason === "unavailable"
            ? "This conversation or result is no longer available."
            : this.reason === "read"
              ? "Could not load workspace reviews."
              : "Could not save the review state.";
  }
}
