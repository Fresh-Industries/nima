import {
  BotId,
  ProjectId,
  ProjectTeamError,
  ProjectTeamWriteInput,
  type ProjectTeam,
  type ProjectTeamWriteResult,
  type ProjectTeamsSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectService from "../project/ProjectService.ts";
import * as BotStore from "./BotStore.ts";

const decodeWrite = Schema.decodeUnknownEffect(ProjectTeamWriteInput);
const isTeamError = Schema.is(ProjectTeamError);
const storageError = (cause: unknown) =>
  isTeamError(cause) ? cause : new ProjectTeamError({ reason: "storage", cause });
export class ProjectTeams extends Context.Service<
  ProjectTeams,
  {
    readonly read: () => Effect.Effect<ProjectTeamsSnapshot, ProjectTeamError>;
    readonly write: (
      input: ProjectTeamWriteInput,
    ) => Effect.Effect<ProjectTeamWriteResult, ProjectTeamError>;
    readonly subscribe: () => Stream.Stream<ProjectTeamsSnapshot, ProjectTeamError>;
  }
>()("t3/bots/ProjectTeams") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bots = yield* BotStore.BotStore;
  const projects = yield* ProjectService.ProjectService;
  const changes = yield* PubSub.sliding<void>(1);
  const read = Effect.fn("ProjectTeams.read")(function* () {
    const teams = yield* sql<{
      project_id: string;
      revision: number;
    }>`SELECT * FROM workspace_project_teams ORDER BY project_id`;
    const members = yield* sql<{
      project_id: string;
      bot_id: string;
      role: string;
    }>`SELECT * FROM workspace_project_team_members ORDER BY project_id,bot_id`;
    return {
      teams: teams.map((team): ProjectTeam => ({
        projectId: ProjectId.make(team.project_id),
        revision: team.revision,
        members: members
          .filter((member) => member.project_id === team.project_id)
          .map((member) => ({ botId: BotId.make(member.bot_id), role: member.role })),
      })),
    };
  }, Effect.mapError(storageError));
  const write = Effect.fn("ProjectTeams.write")(
    function* (raw: ProjectTeamWriteInput) {
      const input = yield* decodeWrite(raw).pipe(
        Effect.mapError((cause) => new ProjectTeamError({ reason: "invalid", cause })),
      );
      if (new Set(input.members.map((member) => member.botId)).size !== input.members.length)
        return yield* new ProjectTeamError({ reason: "invalid" });
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const project = yield* projects.getById(input.projectId);
          if (
            Option.isNone(project) ||
            project.value.archivedAt != null ||
            project.value.deletedAt != null
          )
            return yield* new ProjectTeamError({ reason: "unavailable" });
          const current = (yield* read()).teams.find(
            (team) => team.projectId === input.projectId,
          ) ?? { projectId: input.projectId, revision: 0, members: [] };
          if (current.revision !== input.expectedRevision)
            return { status: "conflict" as const, team: current };
          for (const member of input.members) {
            const bot = yield* bots
              .get(member.botId)
              .pipe(Effect.mapError(() => new ProjectTeamError({ reason: "unavailable" })));
            if (bot.archived && !current.members.some((existing) => existing.botId === bot.id))
              return yield* new ProjectTeamError({ reason: "unavailable" });
          }
          yield* sql`INSERT INTO workspace_project_teams(project_id,revision) VALUES(${input.projectId},1) ON CONFLICT(project_id) DO UPDATE SET revision=revision+1`;
          yield* sql`DELETE FROM workspace_project_team_members WHERE project_id=${input.projectId}`;
          for (const member of input.members)
            yield* sql`INSERT INTO workspace_project_team_members(project_id,bot_id,role) VALUES(${input.projectId},${member.botId},${member.role.trim()})`;
          return {
            status: "saved" as const,
            team: {
              projectId: input.projectId,
              revision: current.revision + 1,
              members: input.members.map((member) => ({ ...member, role: member.role.trim() })),
            },
          };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError(storageError),
    Effect.uninterruptible,
  );
  return ProjectTeams.of({
    read,
    write,
    subscribe: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(read()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(read)),
          );
        }),
      ),
  });
});
export const layer = Layer.effect(ProjectTeams, make);
