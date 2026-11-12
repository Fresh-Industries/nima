import * as Schema from "effect/Schema";
import { ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode, ProviderInteractionMode } from "./providerPolicy.ts";

const Key = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,80}$/));
const Context = Schema.String.check(Schema.isMaxLength(60000));
export const MeetingExperimentCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("start"),
    id: Key,
    threadId: ThreadId,
    consent: Schema.Literal(true),
    modelSelection: Schema.optional(ModelSelection),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
    sdp: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64000)),
  }),
  Schema.Struct({
    action: Schema.Literal("invite"),
    id: Key,
    requestId: Key,
    request: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000)),
    context: Context,
  }),
  Schema.Struct({ action: Schema.Literal("inspect"), id: Key }),
  Schema.Struct({ action: Schema.Literal("close"), id: Key }),
  Schema.Struct({
    action: Schema.Literal("notes"),
    id: Key,
    requestId: Key,
    context: Context,
  }),
]);
export type MeetingExperimentCommand = typeof MeetingExperimentCommand.Type;
export const MeetingExperimentResult = Schema.Struct({
  id: Key,
  threadId: ThreadId,
  sessionId: Schema.String,
  sdp: Schema.optional(Schema.String),
  closed: Schema.Boolean,
  requests: Schema.Array(
    Schema.Struct({
      requestId: Key,
      status: Schema.String,
      answer: Schema.String,
    }),
  ),
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      threadId: Schema.NullOr(ThreadId),
      title: Schema.String,
      status: Schema.String,
    }),
  ),
});
export type MeetingExperimentResult = typeof MeetingExperimentResult.Type;
export class MeetingExperimentError extends Schema.TaggedError<MeetingExperimentError>()(
  "MeetingExperimentError",
  { message: Schema.String },
) {}
