import * as Schema from "effect/Schema";
import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { BotId, BotProfile } from "./bots.ts";

export const WorkSessionCreateInput = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  objective: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(20000)),
  projectId: Schema.NullOr(ProjectId),
  coordinatorBotId: Schema.NullOr(BotId),
});
export type WorkSessionCreateInput = typeof WorkSessionCreateInput.Type;
export const WorkSessionCreated = Schema.Struct({ threadId: ThreadId });
export type WorkSessionCreated = typeof WorkSessionCreated.Type;
export const WorkSessionContext = Schema.Struct({
  title: Schema.String,
  objective: Schema.String,
  projectId: Schema.NullOr(ProjectId),
  coordinator: Schema.NullOr(BotProfile),
  coordinatorRole: Schema.NullOr(Schema.String),
  revision: Schema.Int,
});
export type WorkSessionContext = typeof WorkSessionContext.Type;
export class WorkSessionError extends Schema.TaggedError<WorkSessionError>()("WorkSessionError", {
  reason: Schema.Literals([
    "storage",
    "unavailable",
    "changed",
    "provider-unavailable",
    "workspace-unavailable",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return {
      storage: "Could not prepare this Work session.",
      unavailable: "This Bot or project is unavailable on this environment.",
      changed:
        "This conversation already has a different Work configuration. Open it or create a new session.",
      "provider-unavailable": "Connect a provider and model before opening a Work session.",
      "workspace-unavailable":
        "Use a Bara data folder outside a Git checkout for personal Work sessions.",
    }[this.reason];
  }
}
