import * as Schema from "effect/Schema";
import { ThreadId, ProjectId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { PersonalAgentConfig } from "./personalAgent.ts";

import { BotId } from "./botId.ts";
export { BotId, HOME_BOT_ID } from "./botId.ts";
export const BotToolGroup = Schema.Literals([
  "knowledge",
  "work",
  "browser",
  "studio",
  "environment",
]);
export type BotToolGroup = typeof BotToolGroup.Type;
export const BotToolPolicy = Schema.Struct({
  rules: Schema.Array(
    Schema.Struct({
      group: BotToolGroup,
      access: Schema.Literals(["allowed", "read-only", "approval", "blocked"]),
    }),
  ).check(Schema.isMaxLength(5)),
  projectIds: Schema.NullOr(Schema.Array(ProjectId).check(Schema.isMaxLength(64))),
});
export type BotToolPolicy = typeof BotToolPolicy.Type;
export const BotCapabilities = Schema.Struct({
  toolPolicy: BotToolPolicy,
  skillPageIds: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  ).check(Schema.isMaxLength(8)),
  fallbackModels: Schema.Array(ModelSelection).check(Schema.isMaxLength(3)),
  recallRelationship: Schema.Boolean,
  maxRunMinutes: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 240 }))),
  maxReportedTokens: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 10000000 })),
  ),
  maxReportedCostUsd: Schema.optional(
    Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(10000))),
  ),
  maxPreparationRetries: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  ),
});
export type BotCapabilities = typeof BotCapabilities.Type;
export const DEFAULT_BOT_CAPABILITIES: BotCapabilities = {
  toolPolicy: { rules: [], projectIds: null },
  skillPageIds: [],
  fallbackModels: [],
  recallRelationship: false,
  maxRunMinutes: null,
  maxReportedTokens: null,
};
/** A ceiling on Bara MCP tools, never a grant beyond the existing caller permissions. */
export const BotToolAccess = Schema.Literals(["allowed", "read-only", "blocked"]);
export type BotToolAccess = typeof BotToolAccess.Type;
export const BotConfiguration = Schema.Struct({
  name: PersonalAgentConfig.fields.name,
  avatar: PersonalAgentConfig.fields.avatar,
  description: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  instructions: PersonalAgentConfig.fields.instructions,
  timezone: PersonalAgentConfig.fields.timezone,
  reasoning: PersonalAgentConfig.fields.reasoning,
  modelSelection: Schema.NullOr(ModelSelection),
  // Omission by an older client preserves the saved policy.
  toolAccess: Schema.optional(BotToolAccess),
  capabilities: Schema.optional(BotCapabilities),
});
export type BotConfiguration = typeof BotConfiguration.Type;
export const BotProfile = Schema.Struct({
  id: BotId,
  home: Schema.Boolean,
  config: BotConfiguration,
  threadId: Schema.NullOr(ThreadId),
  archived: Schema.Boolean,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: Schema.NullOr(Schema.String),
});
export type BotProfile = typeof BotProfile.Type;
export const BotToolApproval = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  botNames: Schema.Array(Schema.String),
  tool: Schema.String,
  arguments: Schema.String,
  status: Schema.Literals(["pending", "approved", "rejected", "consumed", "invalidated"]),
  revision: Schema.Int,
  createdAt: Schema.String,
  expiresAt: Schema.String,
});
export type BotToolApproval = typeof BotToolApproval.Type;
export const BotApprovalResolveInput = Schema.Struct({
  id: Schema.String,
  decision: Schema.Literals(["pending", "approved", "rejected"]),
  expectedRevision: Schema.Int,
});
export type BotApprovalResolveInput = typeof BotApprovalResolveInput.Type;
export const BotsSnapshot = Schema.Struct({
  bots: Schema.Array(BotProfile),
  approvals: Schema.optional(Schema.Array(BotToolApproval)),
});
export type BotsSnapshot = typeof BotsSnapshot.Type;
export const BotReadInput = Schema.Struct({ id: BotId });
export const BotCreateInput = Schema.Struct({
  id: BotId,
  name: BotConfiguration.fields.name,
  description: BotConfiguration.fields.description,
  avatar: Schema.optional(BotConfiguration.fields.avatar),
});
export type BotCreateInput = typeof BotCreateInput.Type;
export const BotAssistantCreateInput = Schema.Struct({
  ...BotCreateInput.fields,
  instructions: Schema.optional(BotConfiguration.fields.instructions),
});
export type BotAssistantCreateInput = typeof BotAssistantCreateInput.Type;
export const BotAssistantUpdateInput = Schema.Struct({
  id: BotId,
  expectedRevision: BotProfile.fields.revision,
  name: Schema.optional(BotConfiguration.fields.name),
  description: Schema.optional(BotConfiguration.fields.description),
  instructions: Schema.optional(BotConfiguration.fields.instructions),
  avatar: Schema.optional(BotConfiguration.fields.avatar),
  modelSelection: Schema.optional(BotConfiguration.fields.modelSelection),
  appendInstructions: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
});
export type BotAssistantUpdateInput = typeof BotAssistantUpdateInput.Type;
export const BotWriteInput = Schema.Struct({
  id: BotId,
  config: BotConfiguration,
  archived: Schema.Boolean,
  expectedRevision: BotProfile.fields.revision,
});
export type BotWriteInput = typeof BotWriteInput.Type;
export const BotWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  bot: BotProfile,
});
export type BotWriteResult = typeof BotWriteResult.Type;
export class BotError extends Schema.TaggedError<BotError>()("BotError", {
  reason: Schema.Literals([
    "storage",
    "unavailable",
    "invalid",
    "provider-unavailable",
    "workspace-unavailable",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return {
      storage: "Could not access the bot's saved state.",
      unavailable: "This bot is unavailable on this environment.",
      invalid: "Check the bot settings. The home assistant cannot be archived.",
      "workspace-unavailable":
        "Use a Bara data folder outside a Git checkout to open independent assistant conversations.",
      "provider-unavailable": "Connect a provider and model to open this bot.",
    }[this.reason];
  }
}
