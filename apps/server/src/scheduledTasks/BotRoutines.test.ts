import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  BotId,
  HOME_BOT_ID,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";
import * as BotStore from "../bots/BotStore.ts";
import * as PersonalAgent from "../personalAgent/PersonalAgent.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedFolders from "../project/ManagedProjectFolders.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as Scheduled from "./ScheduledTaskService.ts";

const input: ScheduledTaskUpsertInput = {
  id: ScheduledTaskId.make("morning"),
  ownerBotId: HOME_BOT_ID,
  title: "Morning briefing",
  prompt: "project private context",
  enabled: true,
  schedule: { type: "interval", everyMs: 60000 },
  projectId: ProjectId.make("scratch"),
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "approval-required",
  interactionMode: "default",
};
const unused = Layer.mergeAll(
  NodeCrypto.layer,
  ManagedPolicy.layerTest(),
  Layer.mock(ThreadManagement.ThreadManagementService)({}),
  Layer.mock(SecretRequests.SecretRequests)({}),
);
const seedProject = Effect.fn("test.seedProject")(function* (id: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT OR IGNORE INTO projection_projects(project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES(${id},${id},${`/projects/${id}`},'[]','2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z')`;
});

it.effect(
  "isolates Bot routine turns, keeps current identity, respects memory grants, and prevents overlapping or archived starts",
  () =>
    Effect.gen(function* () {
      const captured = yield* Ref.make<ReadonlyArray<{ threadId: ThreadId; context: string }>>([]);
      const tick = yield* Ref.make<Effect.Effect<void> | null>(null);
      const sql = yield* SqlClient.SqlClient;
      const memory = yield* PersonalAgent.PersonalAgent;
      const dependencies = Layer.mergeAll(
        unused,
        Layer.succeed(Scheduler.Scheduler, {
          register: <E, R>(name: string, effect: Effect.Effect<void, E, R>) =>
            Effect.gen(function* () {
              const context = yield* Effect.context<R>();
              if (name === "scheduled-tasks")
                yield* Ref.set(tick, effect.pipe(Effect.provideContext(context), Effect.orDie));
            }),
        }),
        Layer.mock(ManagedFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: (id) => Effect.succeed(id === "scratch"),
        }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (launch) =>
            Effect.gen(function* () {
              const threadId = launch.threadId!;
              const message = launch.initialMessage!;
              const at = DateTime.formatIso(yield* DateTime.now);
              yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${threadId},${launch.projectId},${launch.title},'codex',${launch.runtimeMode},${launch.interactionMode},${at},${at},'{}')`;
              yield* sql`INSERT INTO orchestration_v2_projection_messages(message_id,thread_id,role,streaming,created_at,updated_at,payload_json) VALUES(${message.messageId},${threadId},'user',0,${at},${at},${JSON.stringify({ scheduledTaskId: message.scheduledTaskId })})`;
              const context = yield* memory.prepare({
                threadId,
                messageId: message.messageId!,
                prompt: message.text,
              });
              yield* Ref.update(captured, (entries) => [...entries, { threadId, context }]);
              return { threadId } as never;
            }).pipe(Effect.orDie),
        }),
      );
      const service = Scheduled.layer.pipe(
        Layer.provide(dependencies),
        Layer.provideMerge(PersonalAgent.layer),
      );
      yield* Effect.gen(function* () {
        const jobs = yield* Scheduled.ScheduledTaskService,
          bots = yield* BotStore.BotStore,
          memory = yield* PersonalAgent.PersonalAgent,
          sql = yield* SqlClient.SqlClient;
        for (const project of ["scratch", "project-a", "project-b"]) yield* seedProject(project);
        let home = yield* memory.read();
        yield* memory.write({
          config: {
            ...home.config,
            instructions: "CURRENT_CITRUS_ROLE",
            timezone: "America/Chicago",
          },
          expectedRevision: home.revision,
        });
        const remember = (scope: Parameters<typeof memory.remember>[0]["scope"], content: string) =>
          memory.remember(
            {
              scope,
              key: "context",
              content,
              action: "remember",
              expectedRevision: 0,
              sources: [],
            },
            { kind: "owner" },
          );
        yield* remember({ kind: "personal" }, "PRIVATE_HOME_FACT");
        yield* remember(
          { kind: "project", projectId: ProjectId.make("scratch") },
          "PRIVATE_SCRATCH_PROJECT",
        );
        yield* remember(
          { kind: "project", projectId: ProjectId.make("project-a") },
          "PROJECT_A_ONLY",
        );
        yield* remember(
          { kind: "project", projectId: ProjectId.make("project-b") },
          "PROJECT_B_ONLY",
        );
        const saved = yield* jobs.upsert(input);
        const { ownerBotId: _owner, ...legacy } = input;
        assert.equal(
          (yield* jobs.upsert({ ...legacy, title: "Updated briefing" })).task.ownerBotId,
          HOME_BOT_ID,
        );
        assert.equal(
          (yield* jobs
            .upsert({ ...input, threadId: ThreadId.make("home-chat") })
            .pipe(Effect.flip)).message.includes("new conversation"),
          true,
        );
        assert.isTrue(
          (yield* jobs
            .upsert({ ...input, ownerBotId: BotId.make("foreign") })
            .pipe(Effect.flip)).message.includes("available Bot"),
        );
        const identity = yield* bots.get(HOME_BOT_ID);
        yield* bots.write({
          id: identity.id,
          config: { ...identity.config, toolAccess: "read-only" },
          archived: false,
          expectedRevision: identity.revision,
        });
        yield* jobs.runNow({ id: saved.task.id });
        let turns = yield* Ref.get(captured);
        assert.equal(yield* bots.toolAccessForThread(turns[0]!.threadId), "read-only");
        assert.include(turns[0]!.context, "CURRENT_CITRUS_ROLE");
        assert.notInclude(turns[0]!.context, "PRIVATE_HOME_FACT");
        assert.notInclude(turns[0]!.context, "PRIVATE_SCRATCH_PROJECT");
        const at = DateTime.formatIso(yield* DateTime.now);
        yield* sql`INSERT INTO orchestration_v2_projection_runs(run_id,thread_id,ordinal,provider,status,requested_at,payload_json) VALUES('active',${turns[0]!.threadId},1,'codex','running',${at},'{}')`;
        assert.include(
          (yield* jobs.runNow({ id: saved.task.id }).pipe(Effect.flip)).message,
          "Could not run",
        );
        yield* TestClock.adjust("1 minute");
        yield* (yield* Ref.get(tick))!;
        assert.lengthOf(yield* Ref.get(captured), 1);
        yield* sql`UPDATE orchestration_v2_projection_runs SET status='completed',completed_at=${at} WHERE run_id='active'`;
        home = yield* memory.read();
        yield* memory.write({
          config: {
            ...home.config,
            instructions: "REVISED_CITRUS_ROLE",
            personalMemoryTaskIds: [saved.task.id],
          },
          expectedRevision: home.revision,
        });
        yield* TestClock.adjust("1 minute");
        yield* (yield* Ref.get(tick))!;
        turns = yield* Ref.get(captured);
        assert.lengthOf(turns, 2);
        assert.notEqual(turns[0]!.threadId, turns[1]!.threadId);
        assert.equal(yield* bots.toolAccessForThread(turns[1]!.threadId), "read-only");
        assert.include(turns[1]!.context, "REVISED_CITRUS_ROLE");
        assert.include(turns[1]!.context, "PRIVATE_HOME_FACT");
        assert.notInclude(turns[1]!.context, "PRIVATE_SCRATCH_PROJECT");
        yield* jobs.setEnabled({ id: saved.task.id, enabled: false });
        yield* TestClock.adjust("1 minute");
        yield* (yield* Ref.get(tick))!;
        assert.lengthOf(yield* Ref.get(captured), 2);
        const fixed = yield* jobs.upsert({
          ...input,
          id: ScheduledTaskId.make("weekly"),
          schedule: { type: "fixed_time", timeOfDay: "08:00", weekdays: [1] },
          projectId: ProjectId.make("project-a"),
        });
        assert.equal(
          fixed.task.schedule.type === "fixed_time" && fixed.task.schedule.timeZone,
          "America/Chicago",
        );
        const worker = yield* bots.create({
          id: BotId.make("researcher"),
          name: "Researcher",
          description: "Research questions",
        });
        const projectJob = yield* jobs.upsert({
          ...input,
          id: ScheduledTaskId.make("project-job"),
          ownerBotId: worker.id,
          projectId: ProjectId.make("project-a"),
        });
        yield* jobs.runNow({ id: projectJob.task.id });
        const projectTurn = (yield* Ref.get(captured)).at(-1)!;
        assert.include(projectTurn.context, "PROJECT_A_ONLY");
        assert.notInclude(projectTurn.context, "PROJECT_B_ONLY");
        assert.notInclude(projectTurn.context, "PRIVATE_HOME_FACT");
        yield* bots.write({
          id: worker.id,
          config: worker.config,
          archived: true,
          expectedRevision: worker.revision,
        });
        assert.include(
          (yield* jobs.list()).tasks.find((task) => task.id === projectJob.task.id)!
            .blockedByPolicy!,
          "archived",
        );
        assert.isTrue(
          (yield* jobs.runNow({ id: projectJob.task.id }).pipe(Effect.flip)).message.includes(
            "Could not run",
          ),
        );
        yield* TestClock.adjust("1 minute");
        yield* (yield* Ref.get(tick))!;
        assert.lengthOf(yield* Ref.get(captured), 3);
        assert.isTrue(
          (yield* jobs.list()).tasks.some((task) => task.id === projectJob.task.id && task.enabled),
        );
        yield* jobs.delete({ id: saved.task.id });
        const afterDelete = yield* memory.read();
        assert.notInclude(afterDelete.config.personalMemoryTaskIds, saved.task.id);
        yield* memory.write({
          config: { ...afterDelete.config, name: "Citrus" },
          expectedRevision: afterDelete.revision,
        });
        assert.equal((yield* memory.read()).threadId, null);
      }).pipe(Effect.provide(service));
    }).pipe(Effect.provide(PersonalAgent.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);

it.effect(
  "persists routine ownership after reopening SQLite and rejects an older save racing an ownership change",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-routines-" });
      const held = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const dependencies = Layer.mergeAll(
        unused,
        Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
        Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
        Layer.mock(ManagedFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () =>
            Deferred.succeed(held, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(false),
            ),
        }),
      );
      const database = () =>
        Scheduled.layer.pipe(
          Layer.provide(dependencies),
          Layer.provideMerge(BotStore.layer),
          Layer.provideMerge(Sqlite.layerFromPath(`${dir}/state.sqlite`)),
        );
      const researcher = BotId.make("researcher");
      yield* Effect.gen(function* () {
        const jobs = yield* Scheduled.ScheduledTaskService,
          bots = yield* BotStore.BotStore;
        yield* bots.create({ id: researcher, name: "Researcher", description: "Research" });
        yield* jobs.upsert(input);
        const { ownerBotId: _owner, ...legacy } = input;
        const old = yield* jobs
          .upsert({ ...legacy, workspaceStrategy: { type: "worktree", baseRef: "main" } })
          .pipe(Effect.exit, Effect.forkChild);
        yield* Deferred.await(held);
        yield* jobs.upsert({ ...input, ownerBotId: researcher });
        yield* Deferred.succeed(release, undefined);
        const outcome = yield* Fiber.join(old);
        assert.equal(outcome._tag, "Failure");
        assert.equal((yield* jobs.list()).tasks[0]?.ownerBotId, researcher);
      }).pipe(Effect.provide(database()), Effect.scoped);
      yield* Effect.gen(function* () {
        const jobs = yield* Scheduled.ScheduledTaskService;
        assert.equal((yield* jobs.list()).tasks[0]?.ownerBotId, researcher);
        assert.isNotNull((yield* jobs.list()).tasks[0]?.nextRunAt);
      }).pipe(Effect.provide(database()), Effect.scoped);
    }).pipe(Effect.provide(NodeServices.layer)),
);
