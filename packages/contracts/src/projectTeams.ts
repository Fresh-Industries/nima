import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import { BotId } from "./bots.ts";

export const ProjectTeamMember = Schema.Struct({
  botId: BotId,
  role: Schema.String.check(Schema.isMaxLength(600)),
});
export const ProjectTeam = Schema.Struct({
  projectId: ProjectId,
  members: Schema.Array(ProjectTeamMember).check(Schema.isMaxLength(30)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ProjectTeam = typeof ProjectTeam.Type;
export const ProjectTeamsSnapshot = Schema.Struct({ teams: Schema.Array(ProjectTeam) });
export type ProjectTeamsSnapshot = typeof ProjectTeamsSnapshot.Type;
export const ProjectTeamWriteInput = Schema.Struct({
  projectId: ProjectId,
  members: ProjectTeam.fields.members,
  expectedRevision: ProjectTeam.fields.revision,
});
export type ProjectTeamWriteInput = typeof ProjectTeamWriteInput.Type;
export const ProjectTeamWriteResult = Schema.Struct({
  status: Schema.Literals(["saved", "conflict"]),
  team: ProjectTeam,
});
export type ProjectTeamWriteResult = typeof ProjectTeamWriteResult.Type;
export class ProjectTeamError extends Schema.TaggedError<ProjectTeamError>()("ProjectTeamError", {
  reason: Schema.Literals(["storage", "unavailable", "invalid"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return {
      storage: "Could not access this project's team.",
      unavailable: "This project or Bot is unavailable on this environment.",
      invalid: "Choose each Bot once and keep the team to 30 teammates.",
    }[this.reason];
  }
}
