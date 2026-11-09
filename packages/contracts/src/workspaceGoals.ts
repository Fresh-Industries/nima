import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkspaceGoalId = TrimmedNonEmptyString.check(Schema.isMaxLength(100));
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ShortText = Schema.String.check(Schema.isMaxLength(1000));
const GoalDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  Schema.makeFilter(
    (value) => {
      const date = DateTime.make(`${value}T00:00:00Z`);
      return Option.isSome(date) && DateTime.formatIso(date.value).slice(0, 10) === value;
    },
    { expected: "a valid date in YYYY-MM-DD format" },
  ),
);
export const WorkspaceGoalMilestone = Schema.Struct({
  id: WorkspaceGoalId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(300)),
  done: Schema.Boolean,
});
export const WorkspaceGoalContent = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  kind: Schema.Literals(["goal", "tracking"]),
  status: Schema.Literals(["active", "paused", "completed", "archived"]),
  context: Schema.String.check(Schema.isMaxLength(8000)),
  targetDate: Schema.NullOr(GoalDate),
  plan: Schema.String.check(Schema.isMaxLength(20000)),
  nextStep: ShortText,
  milestones: Schema.Array(WorkspaceGoalMilestone).check(
    Schema.isMaxLength(100),
    Schema.makeFilter((items) => new Set(items.map((item) => item.id)).size === items.length, {
      expected: "milestones with unique ids",
    }),
  ),
  guidance: Schema.Struct({
    cadence: Schema.Literals(["when-useful", "weekly", "daily", "off"]),
    instructions: Schema.String.check(Schema.isMaxLength(4000)),
  }),
});
export type WorkspaceGoalContent = typeof WorkspaceGoalContent.Type;

export const WorkspaceGoalUpdate = Schema.Struct({
  id: WorkspaceGoalId,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  source: Schema.Literals(["user", "agent"]),
  createdAt: Schema.String,
});
export type WorkspaceGoalUpdate = typeof WorkspaceGoalUpdate.Type;
export const WorkspaceGoal = Schema.Struct({
  id: WorkspaceGoalId,
  content: WorkspaceGoalContent,
  revision: Revision,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  latestUpdate: Schema.NullOr(WorkspaceGoalUpdate),
});
export type WorkspaceGoal = typeof WorkspaceGoal.Type;
export const WorkspaceGoalsSnapshot = Schema.Struct({ goals: Schema.Array(WorkspaceGoal) });
export type WorkspaceGoalsSnapshot = typeof WorkspaceGoalsSnapshot.Type;
export const WorkspaceGoalReadInput = Schema.Struct({ id: WorkspaceGoalId });
export const WorkspaceGoalWriteInput = Schema.Struct({
  id: WorkspaceGoalId,
  content: WorkspaceGoalContent,
  expectedRevision: Revision,
});
export type WorkspaceGoalWriteInput = typeof WorkspaceGoalWriteInput.Type;
export const WorkspaceGoalWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  goal: Schema.NullOr(WorkspaceGoal),
});
export type WorkspaceGoalWriteResult = typeof WorkspaceGoalWriteResult.Type;
export const WorkspaceGoalProgressInput = Schema.Struct({
  id: WorkspaceGoalId,
  updateId: WorkspaceGoalId,
  text: WorkspaceGoalUpdate.fields.text,
});
export type WorkspaceGoalProgressInput = typeof WorkspaceGoalProgressInput.Type;
export const WorkspaceGoalHistoryInput = Schema.Struct({
  id: WorkspaceGoalId,
  beforeSequence: Schema.optional(Revision),
});
export type WorkspaceGoalHistoryInput = typeof WorkspaceGoalHistoryInput.Type;
export const WorkspaceGoalHistory = Schema.Struct({
  updates: Schema.Array(WorkspaceGoalUpdate),
  nextBeforeSequence: Schema.NullOr(Revision),
});
export type WorkspaceGoalHistory = typeof WorkspaceGoalHistory.Type;
export const WorkspaceGoalSummary = Schema.Struct({
  id: WorkspaceGoalId,
  title: WorkspaceGoalContent.fields.title,
  kind: WorkspaceGoalContent.fields.kind,
  status: WorkspaceGoalContent.fields.status,
  nextStep: ShortText,
  targetDate: Schema.NullOr(GoalDate),
  revision: Revision,
  latestUpdate: Schema.NullOr(WorkspaceGoalUpdate),
});
export type WorkspaceGoalSummary = typeof WorkspaceGoalSummary.Type;

export class WorkspaceGoalError extends Schema.TaggedError<WorkspaceGoalError>()(
  "WorkspaceGoalError",
  {
    operation: Schema.Literals(["read", "write"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return this.operation === "read" ? "Could not load goals." : "Could not save this goal.";
  }
}
