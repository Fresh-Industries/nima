import * as Schema from "effect/Schema";
import { ProjectId, ThreadId, MessageId, ScheduledTaskId } from "./baseSchemas.ts";
import { BotId } from "./botId.ts";

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ShortText = Schema.String.check(Schema.isMaxLength(240));
export const PersonalAgentConfig = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  avatar: Schema.String.check(Schema.isMaxLength(32)),
  timezone: Schema.String.check(Schema.isMaxLength(100)),
  reasoning: Schema.Literals(["low", "medium", "high", "xhigh"]),
  instructions: Schema.String.check(Schema.isMaxLength(4000)),
  personalMemoryTaskIds: Schema.Array(ScheduledTaskId).check(Schema.isMaxLength(32)),
});
export type PersonalAgentConfig = typeof PersonalAgentConfig.Type;
export const PersonalAgentProfile = Schema.Struct({
  id: Schema.Literal("primary"),
  config: PersonalAgentConfig,
  threadId: Schema.NullOr(ThreadId),
  revision: Revision,
  updatedAt: Schema.NullOr(Schema.String),
});
export type PersonalAgentProfile = typeof PersonalAgentProfile.Type;
export const PersonalAgentWriteInput = Schema.Struct({
  config: PersonalAgentConfig,
  expectedRevision: Revision,
});
export type PersonalAgentWriteInput = typeof PersonalAgentWriteInput.Type;
export const PersonalAgentWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  profile: PersonalAgentProfile,
});
export type PersonalAgentWriteResult = typeof PersonalAgentWriteResult.Type;
export const PersonalAgentOpenInput = Schema.Struct({
  legacyThreadId: Schema.optional(ThreadId),
  legacyConfig: Schema.optional(PersonalAgentConfig),
});
export type PersonalAgentOpenInput = typeof PersonalAgentOpenInput.Type;
export const MemoryScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("personal") }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("bot"), botId: BotId }),
]);
export type MemoryScope = typeof MemoryScope.Type;
export const MemorySource = Schema.Struct({
  label: ShortText,
  threadId: Schema.NullOr(ThreadId),
  messageId: Schema.NullOr(MessageId),
});
export type MemorySource = typeof MemorySource.Type;
export const MemoryKey = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,79}$/));
export const MemoryFact = Schema.Struct({
  scope: MemoryScope,
  key: MemoryKey,
  content: Schema.String.check(Schema.isMaxLength(1200)),
  sources: Schema.Array(MemorySource).check(Schema.isMaxLength(8)),
  forgotten: Schema.Boolean,
  revision: Revision,
  updatedAt: Schema.String,
});
export type MemoryFact = typeof MemoryFact.Type;
export const MemoryListInput = Schema.Struct({
  scope: Schema.optional(MemoryScope),
  query: Schema.optional(ShortText),
});
export type MemoryListInput = typeof MemoryListInput.Type;
export const MemorySnapshot = Schema.Struct({
  facts: Schema.Array(MemoryFact),
  scopes: Schema.Array(MemoryScope),
});
export type MemorySnapshot = typeof MemorySnapshot.Type;
export const MemoryWriteInput = Schema.Struct({
  scope: MemoryScope,
  key: MemoryKey,
  action: Schema.Literals(["remember", "forget"]),
  content: Schema.String.check(Schema.isMaxLength(1200)),
  sources: Schema.Array(MemorySource).check(Schema.isMaxLength(8)),
  expectedRevision: Revision,
});
export type MemoryWriteInput = typeof MemoryWriteInput.Type;
export const MemoryWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  fact: Schema.NullOr(MemoryFact),
});
export type MemoryWriteResult = typeof MemoryWriteResult.Type;
export class PersonalAgentError extends Schema.TaggedError<PersonalAgentError>()(
  "PersonalAgentError",
  {
    reason: Schema.Literals([
      "storage",
      "unavailable",
      "denied",
      "invalid",
      "provider-unavailable",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return {
      storage: "Could not access the personal assistant's saved state.",
      unavailable: "This assistant resource is unavailable.",
      denied: "This agent cannot access memory in that resource.",
      invalid: "Check the assistant settings, fact, and source references.",
      "provider-unavailable": "Connect a provider and model to open your assistant.",
    }[this.reason];
  }
}
