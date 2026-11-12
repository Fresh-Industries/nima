import * as Schema from "effect/Schema";
import { IsoDateTime, ProjectId, ThreadId } from "./baseSchemas.ts";
import { BotId } from "./bots.ts";

const Key = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,80}$/));
const Context = Schema.String.check(Schema.isMaxLength(240000));
export const PuckoConfigureInput = Schema.Struct({
  activationName: Schema.String.check(Schema.isPattern(/^[\p{L}][\p{L} -]{1,39}$/u)),
  apiKey: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
});
export type PuckoConfigureInput = typeof PuckoConfigureInput.Type;
export const PuckoConfiguration = Schema.Struct({
  activationName: Schema.String,
  keySource: Schema.Literals(["stored", "environment", "missing"]),
});
export const MeetingExperimentCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("start"),
    id: Key,
    consent: Schema.Literal(true),
    projectId: Schema.NullOr(ProjectId),
    coordinatorBotId: Schema.NullOr(BotId),
    sdp: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64000)),
  }),
  Schema.Struct({
    action: Schema.Literal("invite"),
    id: Key,
    requestId: Key,
    delegationId: Schema.optional(Schema.String.check(Schema.isMaxLength(150))),
    request: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
    context: Context,
  }),
  Schema.Struct({
    action: Schema.Literal("sync"),
    id: Key,
    context: Context,
    revision: Schema.Int,
  }),
  Schema.Struct({ action: Schema.Literal("inspect"), id: Key }),
  Schema.Struct({ action: Schema.Literal("close"), id: Key, context: Schema.optional(Context) }),
  Schema.Struct({
    action: Schema.Literal("notes"),
    id: Key,
    requestId: Key,
    context: Schema.optional(Context),
  }),
]);
export type MeetingExperimentCommand = typeof MeetingExperimentCommand.Type;
export const MeetingExperimentResult = Schema.Struct({
  id: Key,
  title: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  sessionId: Schema.String,
  sdp: Schema.optional(Schema.String),
  closed: Schema.Boolean,
  interrupted: Schema.Boolean,
  createdAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
  activationName: Schema.String,
  summary: Schema.String,
  summaryPageId: Schema.NullOr(Schema.String),
  requests: Schema.Array(
    Schema.Struct({
      requestId: Key,
      status: Schema.String,
      answer: Schema.String,
      delegationId: Schema.NullOr(Schema.String),
    }),
  ),
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      threadId: Schema.NullOr(ThreadId),
      title: Schema.String,
      status: Schema.String,
      answer: Schema.String,
    }),
  ),
});
export type MeetingExperimentResult = typeof MeetingExperimentResult.Type;
export const PuckoSnapshot = Schema.Struct({
  configuration: PuckoConfiguration,
  meetings: Schema.Array(MeetingExperimentResult),
});
export type PuckoSnapshot = typeof PuckoSnapshot.Type;
export class MeetingExperimentError extends Schema.TaggedError<MeetingExperimentError>()(
  "MeetingExperimentError",
  { message: Schema.String },
) {}
