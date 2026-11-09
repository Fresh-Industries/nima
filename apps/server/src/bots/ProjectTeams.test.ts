import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { BotId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BotStore from "./BotStore.ts";
import * as ProjectTeams from "./ProjectTeams.ts";

const projectLayer = Layer.mock(ProjectService.ProjectService)({
  getById: (id) =>
    Effect.succeed(
      id === "missing"
        ? Option.none()
        : Option.some({
            id,
            title: id,
            workspaceRoot: `/projects/${id}`,
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-11-05T00:00:00.000Z",
            updatedAt: "2026-11-05T00:00:00.000Z",
            deletedAt: null,
            archivedAt: null,
          }),
    ),
});
const service = ProjectTeams.layer.pipe(
  Layer.provide(projectLayer),
  Layer.provideMerge(BotStore.layer),
);
it.effect(
  "persists one Bot in two independent teams, rejects competing edits, and supplies only its project's role",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-project-teams-" });
      const database = () =>
        service.pipe(Layer.provideMerge(Sqlite.layerFromPath(`${dir}/state.sqlite`)));
      const leadId = BotId.make("lead");
      const first = ProjectId.make("checkout"),
        second = ProjectId.make("preview");
      yield* Effect.gen(function* () {
        const bots = yield* BotStore.BotStore,
          teams = yield* ProjectTeams.ProjectTeams;
        yield* bots.create({
          id: leadId,
          name: "Engineering Lead",
          description: "Coordinate engineering",
        });
        yield* teams.write({
          projectId: first,
          members: [{ botId: leadId, role: "CHECKOUT_ROLE" }],
          expectedRevision: 0,
        });
        yield* teams.write({
          projectId: second,
          members: [{ botId: leadId, role: "PREVIEW_ROLE" }],
          expectedRevision: 0,
        });
        assert.lengthOf((yield* bots.list()).bots, 2);
        assert.equal(
          (yield* teams.write({ projectId: first, members: [], expectedRevision: 0 })).status,
          "conflict",
        );
        assert.equal(
          (yield* teams
            .write({ projectId: ProjectId.make("missing"), members: [], expectedRevision: 0 })
            .pipe(Effect.flip)).reason,
          "unavailable",
        );
        assert.equal(
          (yield* teams
            .write({
              projectId: first,
              members: [{ botId: BotId.make("foreign"), role: "" }],
              expectedRevision: 1,
            })
            .pipe(Effect.flip)).reason,
          "unavailable",
        );
        const sql = yield* SqlClient.SqlClient;
        for (const [id, project] of [
          ["work-a", first],
          ["work-b", second],
          ["personal", null],
        ] as const)
          yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,scope_project_id,coordinator_bot_id,configuration_revision) VALUES(${id},'focus',${id},'Objective','2026-11-05T00:00:00.000Z',${project},${leadId},1)`;
        assert.equal(
          (yield* bots.workForThread(ThreadId.make("work-a")))?.coordinatorRole,
          "CHECKOUT_ROLE",
        );
        assert.equal(
          (yield* bots.workForThread(ThreadId.make("work-b")))?.coordinatorRole,
          "PREVIEW_ROLE",
        );
        assert.isNull((yield* bots.workForThread(ThreadId.make("personal")))?.coordinatorRole);
      }).pipe(Effect.provide(database()), Effect.scoped);
      yield* Effect.gen(function* () {
        const bots = yield* BotStore.BotStore,
          teams = yield* ProjectTeams.ProjectTeams;
        assert.lengthOf((yield* teams.read()).teams, 2);
        const saved = yield* bots.get(leadId);
        yield* bots.write({
          id: leadId,
          config: saved.config,
          archived: true,
          expectedRevision: saved.revision,
        });
        assert.equal(
          (yield* bots.workForThread(ThreadId.make("work-a")))?.coordinatorRole,
          "CHECKOUT_ROLE",
        );
        yield* teams.write({ projectId: first, members: [], expectedRevision: 1 });
        assert.lengthOf(
          (yield* teams.read()).teams.find((team) => team.projectId === second)!.members,
          1,
        );
        assert.equal(
          (yield* teams
            .write({
              projectId: first,
              members: [{ botId: leadId, role: "" }],
              expectedRevision: 2,
            })
            .pipe(Effect.flip)).reason,
          "unavailable",
        );
        assert.lengthOf((yield* bots.list()).bots, 2);
      }).pipe(Effect.provide(database()), Effect.scoped);
    }).pipe(Effect.provide(NodeServices.layer)),
);
