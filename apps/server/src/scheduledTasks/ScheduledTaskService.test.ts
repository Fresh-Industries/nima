import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeUtil from "node:util";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it, vi } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskError,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";

import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Deferred from "effect/Deferred";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as WorkspaceGoals from "../workspace/WorkspaceGoals.ts";

it.effect(
  "retains the goal link through edits and waits for an active goal before dispatching a check-in",
  () =>
    Effect.gen(function* () {
      const launches = yield* Ref.make(0);
      const tick = yield* Ref.make<Effect.Effect<void> | null>(null);
      const sql = yield* SqlClient.SqlClient;
      const dependencies = Layer.mergeAll(
        ManagedPolicy.layerTest(),
        NodeCrypto.layer,
        Layer.succeed(Scheduler.Scheduler, {
          register: <E, R>(name: string, effect: Effect.Effect<void, E, R>) =>
            Effect.gen(function* () {
              const context = yield* Effect.context<R>();
              if (name === "scheduled-tasks")
                yield* Ref.set(tick, effect.pipe(Effect.provideContext(context), Effect.orDie));
            }),
        }),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: () =>
            Ref.update(launches, (count) => count + 1).pipe(
              Effect.as({ threadId: ThreadId.make("goal-checkin-run") } as never),
            ),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
      );
      yield* Effect.gen(function* () {
        const goals = yield* WorkspaceGoals.WorkspaceGoals;
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        const content = {
          title: "Write a field guide",
          kind: "goal" as const,
          status: "active" as const,
          context: "",
          targetDate: null,
          plan: "Draft chapter one",
          nextStep: "Outline",
          milestones: [],
          guidance: { cadence: "weekly" as const, instructions: "Keep it short" },
        };
        yield* goals.write({ id: "guide", content, expectedRevision: 0 });
        const input = {
          id: ScheduledTaskId.make("goal-checkin"),
          goalId: "guide",
          title: "Guide check-in",
          prompt: "Suggest one next step",
          enabled: true,
          schedule: { type: "interval" as const, everyMs: 60_000 },
          projectId: ProjectId.make("project:guide"),
          workspaceStrategy: { type: "root" as const },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
          runtimeMode: "approval-required" as const,
          interactionMode: "default" as const,
        };
        const { task } = yield* service.upsert(input);
        const { goalId: _goalId, ...legacyEdit } = input;
        assert.equal(
          (yield* service.upsert({ ...legacyEdit, title: "Renamed" })).task.goalId,
          "guide",
        );
        assert.equal((yield* service.list()).tasks[0]?.goalId, "guide");
        assert.isTrue(
          Exit.isFailure(yield* service.upsert({ ...input, goalId: "missing" }).pipe(Effect.exit)),
        );
        for (const status of ["paused", "completed", "archived"] as const) {
          const current = yield* goals.read({ id: "guide" });
          yield* goals.write({
            id: "guide",
            content: { ...content, status },
            expectedRevision: current!.revision,
          });
          assert.isTrue(Exit.isFailure(yield* service.runNow({ id: task.id }).pipe(Effect.exit)));
        }
        assert.equal(yield* Ref.get(launches), 0);
        yield* TestClock.setTime(Date.parse(task.nextRunAt!) + 1);
        yield* (yield* Ref.get(tick))!;
        const waiting = (yield* service.list()).tasks[0]!;
        assert.equal(waiting.runCount, 0);
        assert.isTrue(waiting.enabled);
        assert.isTrue(Date.parse(waiting.nextRunAt!) > Date.parse(task.nextRunAt!));
        const current = yield* goals.read({ id: "guide" });
        yield* goals.write({ id: "guide", content, expectedRevision: current!.revision });
        yield* service.runNow({ id: task.id });
        assert.equal(yield* Ref.get(launches), 1);
        assert.equal((yield* service.list()).tasks[0]?.runCount, 1);
        assert.equal(
          (yield* sql<{ goal_id: string }>`SELECT goal_id FROM workspace_goal_checkin_messages`)[0]
            ?.goal_id,
          "guide",
        );
        assert.deepEqual(
          yield* sql<{
            task_id: string;
          }>`SELECT stamp.task_id FROM assistant_memory_job_runs stamp JOIN workspace_goal_checkin_messages goal ON goal.message_id=stamp.message_id`,
          [{ task_id: task.id }],
        );
        yield* service.upsert({ ...legacyEdit, goalId: null });
        yield* sql`DELETE FROM workspace_goals WHERE id = 'guide'`;
        yield* service.runNow({ id: task.id });
        assert.equal(yield* Ref.get(launches), 2);
      }).pipe(
        Effect.provide(
          Layer.merge(ScheduledTaskService.layer, WorkspaceGoals.layer).pipe(
            Layer.provide(dependencies),
          ),
        ),
      );
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

const isScheduledTaskError = Schema.is(ScheduledTaskError);

const insertRow = (
  sql: SqlClient.SqlClient,
  row: {
    id: string | null;
    next: string | null;
    enabled: number;
    status: string;
    scheduleJson?: string;
    prompt?: string;
  },
  now: string,
) =>
  sql`INSERT INTO scheduled_tasks ${sql.insert({
    task_id: row.id,
    title: "task",
    prompt: row.prompt ?? "Run task",
    enabled: row.enabled,
    schedule_json: row.scheduleJson ?? '{"type":"interval","everyMs":60000}',
    project_id: "project:test",
    thread_id: null,
    workspace_strategy_json: '{"type":"root"}',
    model_selection_json: '{"instanceId":"codex","model":"gpt-5"}',
    runtime_mode: "full-access",
    interaction_mode: "default",
    created_by: "user",
    creation_source: "web",
    created_at: now,
    updated_at: now,
    next_run_at: row.next,
    last_run_at: null,
    last_run_status: row.status,
    last_run_error: null,
    run_count: 0,
  })}`;

it.effect("loads only due tasks and skips corrupt due rows without decoding settled tasks", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = "2026-09-09T12:00:00.000Z";
    const secret = "PROMPT-SECRET-DO-NOT-LOG";
    const credential = "CREDENTIAL-SECRET-DO-NOT-LOG";
    for (const row of [
      { id: "due-now", next: now, enabled: 1, status: "never" },
      { id: "", next: now, enabled: 1, status: "never" },
      { id: "   ", next: now, enabled: 1, status: "never" },
      { id: null, next: now, enabled: 1, status: "never" },
      {
        id: "due-earlier",
        next: "2026-09-09T11:00:00.000Z",
        enabled: 1,
        status: "failed",
      },
      { id: "due-bad-date", next: "", enabled: 1, status: "never" },
      {
        id: "due-corrupt",
        next: now,
        enabled: 1,
        status: "never",
        scheduleJson: "broken",
      },
      {
        id: "due-cred",
        next: now,
        enabled: 1,
        status: "never",
        scheduleJson: `{"type":"interval","everyMs":"${credential}"}`,
      },
      { id: "disabled", next: now, enabled: 0, status: "never", scheduleJson: "broken" },
      {
        id: "future",
        next: "2026-09-09T12:00:00.001Z",
        enabled: 1,
        status: "never",
        scheduleJson: "broken",
      },
      {
        id: "unscheduled",
        next: null,
        enabled: 1,
        status: "never",
        scheduleJson: "broken",
      },
      { id: "running", next: now, enabled: 1, status: "running", scheduleJson: "broken" },
    ]) {
      yield* insertRow(sql, { ...row, prompt: secret }, now);
    }
    const warnings: unknown[] = [];
    const tasks = yield* ScheduledTaskService.listDueTasks(DateTime.makeUnsafe(now)).pipe(
      Effect.provide(
        Logger.layer([
          Logger.make(({ message }) => {
            warnings.push(message);
          }),
        ]),
      ),
    );
    assert.deepEqual(
      tasks.map((task) => task.id),
      ["due-earlier", "due-now"],
    );
    assert.equal(warnings.length, 6);
    const annotations = warnings.map(
      (warning) => (warning as ReadonlyArray<unknown>)[1] as Record<string, unknown>,
    );
    assert.deepEqual(
      annotations.map((annotation) => annotation.taskId),
      ["due-bad-date", null, "", "   ", "due-corrupt", "due-cred"],
    );
    const causes = annotations.map((annotation) => annotation.cause);
    assert.deepEqual(
      causes.map((cause) => (isScheduledTaskError(cause) ? cause.taskId : undefined)),
      [undefined, undefined, undefined, undefined, "due-corrupt", "due-cred"],
    );
    for (const cause of causes) {
      if (cause !== undefined) assert.isTrue(isScheduledTaskError(cause));
    }
    const rendered = NodeUtil.inspect(annotations, { depth: null });
    assert.isFalse(rendered.includes(secret));
    assert.isFalse(rendered.includes(credential));
    const running = yield* sql<{
      last_run_status: string;
    }>`SELECT last_run_status FROM scheduled_tasks WHERE task_id = 'running'`;
    assert.equal(running[0]?.last_run_status, "running");
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "releases interrupted runs on startup and still executes due tasks, skipping corrupt rows",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-09-09T12:00:00.000Z";
      const hugeInterval = '{"type":"interval","everyMs":9000000000000000}';
      for (const row of [
        { id: "stuck-valid", next: now, status: "running" },
        { id: "stuck-corrupt", next: now, status: "running", scheduleJson: "broken" },
        { id: "stuck-huge", next: now, status: "running", scheduleJson: hugeInterval },
        { id: null, next: now, status: "running" },
        { id: "due-bad-date", next: "", status: "never" },
        { id: "due-healthy", next: now, status: "never" },
        { id: "due-huge", next: now, status: "never", scheduleJson: hugeInterval },
        { id: "due-second", next: now, status: "never" },
        { id: "due-third", next: now, status: "never" },
      ]) {
        yield* insertRow(sql, { ...row, enabled: 1 }, now);
      }

      yield* TestClock.setTime(Date.parse(now) + 1_000);
      const dispatched = yield* Ref.make(0);
      const lastDispatched = yield* Deferred.make<void>();
      const releaseLast = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            Layer.provideMerge(
              ScheduledTaskService.layer,
              Layer.mergeAll(
                ManagedPolicy.layerTest(),
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                  launch: () =>
                    Ref.updateAndGet(dispatched, (n) => n + 1).pipe(
                      Effect.andThen((n) =>
                        n === 4
                          ? Deferred.succeed(lastDispatched, undefined).pipe(
                              Effect.andThen(Deferred.await(releaseLast)),
                            )
                          : Effect.void,
                      ),
                      Effect.andThen(Effect.die(new Error("test launch failure"))),
                    ),
                }),
                Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                  namedProjectsRoot: "/projects",
                  isScratchProject: () => Effect.succeed(false),
                }),
                Layer.mock(ThreadManagementService.ThreadManagementService)({}),
                Layer.mock(SecretRequests.SecretRequests)({}),
                NodeCrypto.layer,
                Scheduler.layer,
              ),
            ),
          );
          // The poll delays before its first pass; advance the frozen clock once.
          yield* TestClock.adjust("6 seconds");
          yield* Deferred.await(lastDispatched);
          const inflight = yield* sql<{
            last_run_status: string;
          }>`SELECT last_run_status FROM scheduled_tasks WHERE task_id = 'due-third'`;
          assert.equal(inflight[0]?.last_run_status, "running");
          yield* Deferred.succeed(releaseLast, undefined);
        }),
      );

      const rows = yield* sql<{
        task_id: string | null;
        last_run_status: string;
        last_run_error: string | null;
        next_run_at: string | null;
        run_count: number;
      }>`SELECT task_id, last_run_status, last_run_error, next_run_at, run_count
       FROM scheduled_tasks ORDER BY task_id`;
      const byId = new Map(rows.map((row) => [row.task_id, row]));
      assert.equal(rows.length, 9);
      assert.equal(byId.get("stuck-valid")?.last_run_status, "failed");
      assert.isNotNull(byId.get("stuck-valid")?.next_run_at);
      assert.equal(byId.get("stuck-corrupt")?.last_run_status, "failed");
      assert.equal(byId.get(null)?.last_run_status, "failed");
      const stuckHuge = byId.get("stuck-huge");
      assert.equal(stuckHuge?.last_run_status, "failed");
      assert.isNull(stuckHuge?.next_run_at);
      for (const id of ["stuck-valid", "stuck-corrupt", "stuck-huge", null]) {
        const row = byId.get(id);
        assert.equal(row?.last_run_error, "Run was interrupted by a server restart.");
        assert.equal(row?.run_count, 1);
      }
      for (const id of ["due-healthy", "due-huge", "due-second"]) {
        const row = byId.get(id);
        assert.equal(row?.last_run_status, "failed");
        assert.isTrue(row?.last_run_error?.includes("test launch failure") === true);
        assert.equal(row?.run_count, 1);
      }
      assert.isNull(byId.get("due-huge")?.next_run_at);
      assert.equal(byId.get("due-bad-date")?.last_run_status, "never");
      assert.equal(byId.get("due-bad-date")?.run_count, 0);
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "treats a next_run_at corrupted before the dispatch re-read as not due instead of defecting the poll",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-09-09T12:00:00.000Z";
      for (const row of [
        { id: "run-a", next: now, status: "never" },
        { id: "run-b-victim", next: now, status: "never" },
        { id: "run-c", next: now, status: "never" },
        { id: "run-d", next: now, status: "never" },
      ]) {
        yield* insertRow(sql, { ...row, enabled: 1 }, now);
      }
      yield* TestClock.setTime(Date.parse(now) + 1_000);
      const dispatched = yield* Ref.make(0);
      const lastDispatched = yield* Deferred.make<void>();
      const releaseLast = yield* Deferred.make<void>();
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            Layer.provideMerge(
              ScheduledTaskService.layer,
              Layer.mergeAll(
                ManagedPolicy.layerTest(),
                Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                  launch: () =>
                    Ref.updateAndGet(dispatched, (n) => n + 1).pipe(
                      Effect.andThen((n) =>
                        n === 1
                          ? sql`UPDATE scheduled_tasks
                                SET next_run_at = ''
                                WHERE task_id = 'run-b-victim'`.pipe(Effect.asVoid, Effect.orDie)
                          : n === 3
                            ? Deferred.succeed(lastDispatched, undefined).pipe(
                                Effect.andThen(Deferred.await(releaseLast)),
                              )
                            : Effect.void,
                      ),
                      Effect.andThen(Effect.die(new Error("test launch failure"))),
                    ),
                }),
                Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                  namedProjectsRoot: "/projects",
                  isScratchProject: () => Effect.succeed(false),
                }),
                Layer.mock(ThreadManagementService.ThreadManagementService)({}),
                Layer.mock(SecretRequests.SecretRequests)({}),
                NodeCrypto.layer,
                Scheduler.layer,
              ),
            ),
          );
          yield* TestClock.adjust("6 seconds");
          yield* Deferred.await(lastDispatched);
          assert.equal(yield* Ref.get(dispatched), 3);
          const rows = yield* sql<{
            task_id: string;
            last_run_status: string;
            next_run_at: string | null;
            run_count: number;
          }>`SELECT task_id, last_run_status, next_run_at, run_count
             FROM scheduled_tasks ORDER BY task_id`;
          const byId = new Map(rows.map((row) => [row.task_id, row]));
          const victim = byId.get("run-b-victim");
          assert.equal(victim?.last_run_status, "never");
          assert.equal(victim?.run_count, 0);
          assert.equal(victim?.next_run_at, "");
          for (const id of ["run-a", "run-c"]) {
            const row = byId.get(id);
            assert.equal(row?.last_run_status, "failed");
            assert.equal(row?.run_count, 1);
          }
          yield* Deferred.succeed(releaseLast, undefined);
        }),
      );
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("thread cleanup notifies subscribers and a finishing run cannot recreate the task", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const subscribed = yield* Deferred.make<void>();
    const running = yield* Deferred.make<void>();
    const removed = yield* Deferred.make<void>();
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            sendToThread: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Effect.die("test dispatch failure")),
              ),
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          NodeCrypto.layer,
          Scheduler.layer,
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const threadId = ThreadId.make("thread:deleted-during-run");
      const { task } = yield* service.upsert({
        id: ScheduledTaskId.make("task:deleted-during-run"),
        title: "Check orchestration",
        prompt: "Check progress",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: ProjectId.make("project:test"),
        threadId,
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      yield* service.subscribeList().pipe(
        Stream.runForEach(({ tasks }) => {
          const current = tasks.find((candidate) => candidate.id === task.id);
          if (current === undefined) return Deferred.succeed(removed, undefined);
          return current.lastRunStatus === "running"
            ? Deferred.succeed(running, undefined)
            : Deferred.succeed(subscribed, undefined);
        }),
        Effect.forkChild,
      );
      yield* Deferred.await(subscribed);
      const run = yield* service.runNow({ id: task.id }).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Deferred.await(running);
      yield* service.deleteForThread(threadId);
      yield* Deferred.await(removed);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(run);
      assert.lengthOf((yield* service.list()).tasks, 0);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a bound run follows its thread when promotion moves it mid-send", () =>
  Effect.gen(function* () {
    const scratch = ProjectId.make("project:scratch");
    const promoted = ProjectId.make("project:promoted");
    const sends = yield* Ref.make<Array<{ projectId: ProjectId; commandId: string }>>([]);
    // Rebind lands first, then the promotion commits between the shell read and the retry.
    const shellProjects = yield* Ref.make([scratch, promoted]);
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            sendToThread: (input) =>
              Ref.updateAndGet(sends, (all) => [
                ...all,
                { projectId: input.projectId, commandId: input.commandId },
              ]).pipe(
                Effect.flatMap((all) =>
                  all.length < 3
                    ? Effect.fail(
                        new ThreadManagementService.ThreadManagementThreadNotFoundError({
                          projectId: input.projectId,
                          threadId: input.threadId,
                        }),
                      )
                    : Effect.succeed({} as never),
                ),
              ),
            getThreadShell: () =>
              Ref.modify(shellProjects, ([next, ...rest]) => [
                { projectId: next ?? promoted } as never,
                rest,
              ]),
          }),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          NodeCrypto.layer,
          Scheduler.layer,
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const threadId = ThreadId.make("thread:promoted-during-run");
      const { task } = yield* service.upsert({
        id: ScheduledTaskId.make("task:promoted-during-run"),
        title: "Check in",
        prompt: "Check progress",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: promoted,
        threadId,
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      const result = yield* service.runNow({ id: task.id });

      assert.equal(result.threadId, threadId);
      const attempts = yield* Ref.get(sends);
      assert.deepEqual(
        attempts.map((attempt) => attempt.projectId),
        [promoted, scratch, promoted],
      );
      assert.equal(new Set(attempts.map((attempt) => attempt.commandId)).size, 1);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("refuses saving an enabled task above the policy ceiling", () =>
  Effect.gen(function* () {
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest({
            schemaVersion: 1,
            organization: "Example Corp",
            limits: { maxRuntimeMode: "auto-accept-edits" },
          }),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          NodeCrypto.layer,
          Scheduler.layer,
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const save = (enabled: boolean) =>
        service.upsert({
          id: ScheduledTaskId.make("task:above-ceiling"),
          title: "Nightly",
          prompt: "Check progress",
          enabled,
          schedule: { type: "interval", everyMs: 60_000 },
          projectId: ProjectId.make("project:test"),
          workspaceStrategy: { type: "root" },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
        });
      const refused = yield* save(true).pipe(Effect.flip);
      assert.equal(refused.message, "Example Corp limits threads to Auto-accept edits.");
      assert.lengthOf((yield* service.list()).tasks, 0);
      // A disabled task does not run, so it can still be saved.
      yield* save(false);
      assert.lengthOf((yield* service.list()).tasks, 1);
      // Nor can it be switched back on while its mode is above the ceiling.
      const reenabled = yield* service
        .setEnabled({ id: ScheduledTaskId.make("task:above-ceiling"), enabled: true })
        .pipe(Effect.flip);
      assert.equal(reenabled.message, "Example Corp limits threads to Auto-accept edits.");
      // A task bound to a thread runs in that thread's mode, so its own is not checked.
      yield* service.upsert({
        id: ScheduledTaskId.make("task:bound"),
        title: "Follow up",
        prompt: "Check progress",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: ProjectId.make("project:test"),
        threadId: ThreadId.make("thread:bound"),
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a run interrupted right after it reserves the task does not block the next run", () =>
  Effect.gen(function* () {
    const launches = yield* Ref.make(0);
    const layer = ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ManagedPolicy.layerTest(),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({
            launch: () =>
              Ref.update(launches, (n) => n + 1).pipe(
                Effect.as({ threadId: ThreadId.make("thread:launched"), resumed: false } as never),
              ),
          }),
          Layer.mock(ThreadManagementService.ThreadManagementService)({}),
          Layer.mock(SecretRequests.SecretRequests)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
            namedProjectsRoot: "/projects",
            isScratchProject: () => Effect.succeed(false),
          }),
          NodeCrypto.layer,
          Layer.succeed(Scheduler.Scheduler, { register: () => Effect.void }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const { task } = yield* service.upsert({
        id: ScheduledTaskId.make("task:interrupted-reservation"),
        title: "Check in",
        prompt: "Check progress",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: ProjectId.make("project:test"),
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });

      // The reservation is the first Set.add of the task id; interrupt the run right there.
      const add = Set.prototype.add;
      let interrupted = false;
      const first = yield* Effect.gen(function* () {
        using _reserve = vi.spyOn(Set.prototype, "add").mockImplementation(function (
          this: Set<unknown>,
          value: unknown,
        ) {
          const result = add.call(this, value);
          if (value === task.id && !interrupted) {
            interrupted = true;
            Fiber.getCurrent()?.interruptUnsafe();
          }
          return result;
        });
        return yield* service
          .runNow({ id: task.id })
          .pipe(Effect.forkChild, Effect.flatMap(Fiber.await));
      });
      assert.isTrue(interrupted);
      assert.isTrue(Exit.hasInterrupts(first));

      const second = yield* service.runNow({ id: task.id });
      assert.equal(second.threadId, ThreadId.make("thread:launched"));
      assert.equal(yield* Ref.get(launches), 1);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "reads only attributed bot runs, keeps queued messages, and paginates shared conversations",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-11-03T20:00:00.000Z";
      yield* insertRow(sql, { id: "bot:one", next: null, enabled: 0, status: "never" }, now);
      for (const id of ["shared", "deleted"]) {
        yield* sql`INSERT INTO orchestration_v2_projection_threads ${sql.insert({
          thread_id: id,
          project_id: "project:test",
          title: `Conversation ${id}`,
          default_provider: "codex",
          runtime_mode: "full-access",
          interaction_mode: "default",
          created_at: now,
          updated_at: now,
          deleted_at: id === "deleted" ? now : null,
          payload_json: "{}",
        })}`;
      }
      for (const [id, threadId, scheduledTaskId, role] of [
        ["a", "shared", "bot:one", "user"],
        ["b", "shared", "bot:one", "user"],
        ["c", "shared", "bot:one", "user"],
        ["d", "shared", "bot:other", "user"],
        ["e", "shared", null, "user"],
        ["f", "shared", "bot:one", "assistant"],
        ["g", "deleted", "bot:one", "user"],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_messages ${sql.insert({
          message_id: id,
          thread_id: threadId,
          run_id: null,
          node_id: null,
          role,
          streaming: 0,
          created_at: now,
          updated_at: now,
          payload_json: JSON.stringify({ scheduledTaskId, text: "Same prompt, different source" }),
        })}`;
      }
      for (const [id, messageId, ordinal, status] of [
        ["run:a", "a", 1, "completed"],
        ["run:b-old", "b", 2, "interrupted"],
        ["run:b", "b", 3, "running"],
        ["run:other", "d", 4, "completed"],
      ] as const) {
        yield* sql`INSERT INTO orchestration_v2_projection_runs ${sql.insert({
          run_id: id,
          thread_id: "shared",
          ordinal,
          provider: "codex",
          status,
          requested_at: now,
          completed_at: status === "completed" ? now : null,
          payload_json: JSON.stringify({ userMessageId: messageId }),
        })}`;
      }
      const layer = ScheduledTaskService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            ManagedPolicy.layerTest(),
            Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
            Layer.mock(ThreadManagementService.ThreadManagementService)({}),
            Layer.mock(SecretRequests.SecretRequests)({}),
            Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
              namedProjectsRoot: "/projects",
              isScratchProject: () => Effect.succeed(false),
            }),
            NodeCrypto.layer,
            Layer.succeed(Scheduler.Scheduler, { register: () => Effect.void }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        const first = yield* service.listRuns({ id: ScheduledTaskId.make("bot:one"), limit: 2 });
        assert.deepEqual(
          first.runs.map((entry) => [entry.messageId, entry.runId, entry.status]),
          [
            ["c", null, null],
            ["b", "run:b", "running"],
          ],
        );
        assert.equal(first.runs[1]?.threadTitle, "Conversation shared");
        assert.isNotNull(first.nextCursor);
        const second = yield* service.listRuns({
          id: ScheduledTaskId.make("bot:one"),
          limit: 2,
          before: first.nextCursor!,
        });
        assert.deepEqual(
          second.runs.map((entry) => entry.messageId),
          ["a"],
        );
        assert.isNull(second.nextCursor);
        const missing = yield* service
          .listRuns({ id: ScheduledTaskId.make("missing") })
          .pipe(Effect.flip);
        assert.equal(missing._tag, "ScheduledTaskError");
        const plan = yield* sql<{ detail: string }>`EXPLAIN QUERY PLAN SELECT message_id
        FROM orchestration_v2_projection_messages WHERE role = 'user'
          AND json_extract(payload_json, '$.scheduledTaskId') = 'bot:one'
        ORDER BY created_at DESC, message_id DESC LIMIT 20`;
        assert.isTrue(
          plan.some((row) => row.detail.includes("idx_messages_scheduled_task_history")),
        );
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
