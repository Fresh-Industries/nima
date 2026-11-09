import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { WorkspaceGoalContent, WorkspaceGoalsSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Goals from "./WorkspaceGoals.ts";

const memory = Goals.layer.pipe(Layer.provide(Sqlite.layerMemory));
const content: WorkspaceGoalContent = {
  title: "Finish the field guide",
  kind: "goal",
  status: "active",
  context: "Make knowledge useful.",
  targetDate: null,
  plan: "# Plan\n\n- [ ] Draft\n\n**Keep this.**",
  nextStep: "Write the outline",
  milestones: [{ id: "outline", title: "Outline", done: false }],
  guidance: { cadence: "weekly", instructions: "Suggest one manageable next step." },
};

it.effect("isolates goals, rejects competing edits and retries lost replies idempotently", () =>
  Effect.gen(function* () {
    const goals = yield* Goals.WorkspaceGoals;
    const results = yield* Effect.all(
      [
        goals.write({ id: "guide", content, expectedRevision: 0 }),
        goals.write({
          id: "guide",
          content: { ...content, title: "A competing title" },
          expectedRevision: 0,
        }),
        goals.write({
          id: "health",
          content: { ...content, kind: "tracking" },
          expectedRevision: 0,
        }),
      ],
      { concurrency: "unbounded" },
    );
    assert.deepEqual(
      results
        .slice(0, 2)
        .map((result) => result.status)
        .sort(),
      ["conflict", "saved"],
    );
    assert.equal(results[2]?.status, "saved");
    const saved = results.slice(0, 2).find((result) => result.status === "saved")!;
    assert.deepEqual(
      yield* goals.write({ id: "guide", content: saved.goal!.content, expectedRevision: 0 }),
      saved,
    );
    const archived = yield* goals.write({
      id: "guide",
      content: { ...saved.goal!.content, status: "archived" },
      expectedRevision: 1,
    });
    assert.equal(archived.goal?.revision, 2);
    const conflict = yield* goals.write({ id: "guide", content, expectedRevision: 1 });
    assert.deepEqual(conflict, { status: "conflict", goal: archived.goal });
    const reopened = yield* goals.write({ id: "guide", content, expectedRevision: 2 });
    assert.equal(reopened.goal?.content.status, "active");
    assert.equal((yield* goals.read({ id: "health" }))?.revision, 1);
    const summaries = yield* goals.summaries();
    assert.equal(summaries.length, 2);
    assert.isFalse("plan" in summaries[0]!);
  }).pipe(Effect.provide(memory)),
);

it.effect("appends concurrent progress without losing entries and paginates the full history", () =>
  Effect.gen(function* () {
    const goals = yield* Goals.WorkspaceGoals;
    assert.isNull(
      yield* goals.addProgress({ id: "missing", updateId: "missing", text: "No goal" }, "agent"),
    );
    yield* goals.write({ id: "guide", content, expectedRevision: 0 });
    yield* Effect.all(
      Array.from({ length: 25 }, (_, index) =>
        goals.addProgress(
          {
            id: "guide",
            updateId: `update-${index}`,
            text: `Chapter ${index}`,
          },
          index % 2 === 0 ? "user" : "agent",
        ),
      ),
      { concurrency: "unbounded" },
    );
    const current = yield* goals.read({ id: "guide" });
    assert.equal(current?.revision, 26);
    assert.deepEqual(current?.content, content);
    yield* goals.addProgress({ id: "guide", updateId: "update-0", text: "Chapter 0" }, "user");
    assert.deepEqual(yield* goals.read({ id: "guide" }), current);
    assert.isTrue(
      Exit.isFailure(
        yield* goals
          .addProgress({ id: "guide", updateId: "update-0", text: "Overwrite history" }, "agent")
          .pipe(Effect.exit),
      ),
    );
    const first = yield* goals.history({ id: "guide" });
    assert.equal(first.updates.length, 20);
    assert.isNotNull(first.nextBeforeSequence);
    assert.deepEqual(first.updates[0], current!.latestUpdate!);
    const second = yield* goals.history({ id: "guide", beforeSequence: first.nextBeforeSequence! });
    assert.equal(second.updates.length, 5);
    assert.isNull(second.nextBeforeSequence);
    assert.equal(
      new Set([...first.updates, ...second.updates].map((update) => update.id)).size,
      25,
    );
    assert.equal(second.updates.at(-1)?.source, "user");
    assert.equal(
      (yield* goals.write({
        id: "guide",
        content: { ...content, nextStep: "stale" },
        expectedRevision: 1,
      })).status,
      "conflict",
    );
  }).pipe(Effect.provide(memory)),
);

it.effect("streams committed content and progress to connected clients", () =>
  Effect.gen(function* () {
    const goals = yield* Goals.WorkspaceGoals;
    const snapshots = yield* Queue.unbounded<WorkspaceGoalsSnapshot>();
    const stream = yield* goals.subscribe().pipe(
      Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
      Effect.forkChild,
    );
    assert.deepEqual(yield* Queue.take(snapshots), { goals: [] });
    const saved = yield* goals.write({ id: "guide", content, expectedRevision: 0 });
    assert.deepEqual((yield* Queue.take(snapshots)).goals, [saved.goal!]);
    const updated = yield* goals.addProgress(
      { id: "guide", updateId: "first", text: "Outline written" },
      "agent",
    );
    assert.deepEqual((yield* Queue.take(snapshots)).goals, [updated!]);
    yield* Fiber.interrupt(stream);
  }).pipe(Effect.provide(memory)),
);

it.effect("rejects invalid dates, content and duplicate milestone ids without writing", () =>
  Effect.gen(function* () {
    const goals = yield* Goals.WorkspaceGoals;
    for (const invalid of [
      { ...content, title: " " },
      { ...content, plan: "x".repeat(20001) },
      { ...content, targetDate: "2027-02-29" },
      { ...content, milestones: [content.milestones[0]!, content.milestones[0]!] },
    ])
      assert.isTrue(
        Exit.isFailure(
          yield* goals
            .write({ id: "guide", content: invalid, expectedRevision: 0 })
            .pipe(Effect.exit),
        ),
      );
    assert.deepEqual(yield* goals.list(), { goals: [] });
    assert.isTrue(
      Exit.isFailure(yield* goals.history({ id: "guide", beforeSequence: -1 }).pipe(Effect.exit)),
    );
    const leap = yield* goals.write({
      id: "guide",
      content: { ...content, targetDate: "2028-02-29" },
      expectedRevision: 0,
    });
    assert.equal(leap.status, "saved");
  }).pipe(Effect.provide(memory)),
);

it.effect("retains Markdown, guidance and progress after reopening the database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "bara-goals-" });
    const database = () =>
      Goals.layer.pipe(Layer.provide(Sqlite.layerFromPath(`${dir}/goals.sqlite`)));
    const saved = yield* Effect.gen(function* () {
      const goals = yield* Goals.WorkspaceGoals;
      yield* goals.write({ id: "guide", content, expectedRevision: 0 });
      return yield* goals.addProgress(
        { id: "guide", updateId: "outline", text: "# Done\n\nOutline saved." },
        "user",
      );
    }).pipe(Effect.provide(database()));
    const reopened = yield* Effect.gen(function* () {
      const goals = yield* Goals.WorkspaceGoals;
      return {
        goal: yield* goals.read({ id: "guide" }),
        history: yield* goals.history({ id: "guide" }),
      };
    }).pipe(Effect.provide(database()));
    assert.deepEqual(reopened.goal, saved);
    assert.deepEqual(reopened.history.updates, [saved!.latestUpdate!]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
