import {
  WorkspaceGoal,
  WorkspaceGoalContent,
  WorkspaceGoalError,
  WorkspaceGoalHistory,
  WorkspaceGoalHistoryInput,
  WorkspaceGoalProgressInput,
  WorkspaceGoalReadInput,
  WorkspaceGoalsSnapshot,
  WorkspaceGoalSummary,
  WorkspaceGoalWriteInput,
  type WorkspaceGoalWriteResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

export class WorkspaceGoals extends Context.Service<
  WorkspaceGoals,
  {
    readonly list: () => Effect.Effect<WorkspaceGoalsSnapshot, WorkspaceGoalError>;
    readonly summaries: () => Effect.Effect<
      ReadonlyArray<WorkspaceGoalSummary>,
      WorkspaceGoalError
    >;
    readonly read: (
      input: typeof WorkspaceGoalReadInput.Type,
    ) => Effect.Effect<WorkspaceGoal | null, WorkspaceGoalError>;
    readonly write: (
      input: WorkspaceGoalWriteInput,
    ) => Effect.Effect<WorkspaceGoalWriteResult, WorkspaceGoalError>;
    readonly addProgress: (
      input: WorkspaceGoalProgressInput,
      source: "user" | "agent",
    ) => Effect.Effect<WorkspaceGoal | null, WorkspaceGoalError>;
    readonly history: (
      input: WorkspaceGoalHistoryInput,
    ) => Effect.Effect<WorkspaceGoalHistory, WorkspaceGoalError>;
    readonly subscribe: () => Stream.Stream<WorkspaceGoalsSnapshot, WorkspaceGoalError>;
  }
>()("t3/workspace/WorkspaceGoals") {}

const GoalRow = Schema.Struct({
  id: Schema.String,
  contentJson: Schema.String,
  revision: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  latestUpdateJson: Schema.NullOr(Schema.String),
});
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(GoalRow));
const encodeContent = Schema.encodeEffect(Schema.fromJsonString(WorkspaceGoalContent));
const decodeContent = Schema.decodeEffect(Schema.fromJsonString(WorkspaceGoalContent));
const decodeUpdate = Schema.decodeEffect(Schema.fromJsonString(WorkspaceGoal.fields.latestUpdate));
const decodeWrite = Schema.decodeEffect(WorkspaceGoalWriteInput);
const decodeProgress = Schema.decodeEffect(WorkspaceGoalProgressInput);
const decodeHistoryInput = Schema.decodeEffect(WorkspaceGoalHistoryInput);
const decodeHistory = Schema.decodeUnknownEffect(WorkspaceGoalHistory);
const decodeRead = Schema.decodeEffect(WorkspaceGoalReadInput);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.sliding<void>(1);
  const rows = Effect.fn("WorkspaceGoals.rows")(
    function* (id: string | undefined) {
      const raw =
        yield* sql`SELECT g.id, g.content_json AS "contentJson", g.revision, g.created_at AS "createdAt", g.updated_at AS "updatedAt",
      (SELECT json_object('id', u.update_id, 'sequence', u.sequence, 'text', u.text, 'source', u.source, 'createdAt', u.created_at)
       FROM workspace_goal_updates u WHERE u.goal_id = g.id ORDER BY u.sequence DESC LIMIT 1) AS "latestUpdateJson"
      FROM workspace_goals g WHERE ${id === undefined ? sql`1 = 1` : sql`g.id = ${id}`} ORDER BY g.created_at, g.id`;
      const decoded = yield* decodeRows(raw);
      return yield* Effect.forEach(decoded, (row) =>
        Effect.gen(function* () {
          return {
            id: row.id,
            content: yield* decodeContent(row.contentJson),
            revision: row.revision,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            latestUpdate:
              row.latestUpdateJson === null ? null : yield* decodeUpdate(row.latestUpdateJson),
          };
        }),
      );
    },
    Effect.mapError((cause) => new WorkspaceGoalError({ operation: "read", cause })),
  );

  const read = Effect.fn("WorkspaceGoals.read")(
    function* (input: typeof WorkspaceGoalReadInput.Type) {
      const { id } = yield* decodeRead(input);
      return (yield* rows(id))[0] ?? null;
    },
    Effect.mapError((cause) => new WorkspaceGoalError({ operation: "read", cause })),
  );
  const list = Effect.fn("WorkspaceGoals.list")(function* () {
    return { goals: yield* rows(undefined) };
  });
  const write = Effect.fn("WorkspaceGoals.write")(
    function* (raw: WorkspaceGoalWriteInput) {
      const input = yield* decodeWrite(raw);
      const encoded = yield* encodeContent(input.content);
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* read(input);
          if (current && (yield* encodeContent(current.content)) === encoded)
            return { status: "saved" as const, goal: current };
          if ((current?.revision ?? 0) !== input.expectedRevision)
            return { status: "conflict" as const, goal: current };
          const now = DateTime.formatIso(yield* DateTime.now);
          if (current)
            yield* sql`UPDATE workspace_goals SET content_json = ${encoded}, revision = revision + 1, updated_at = ${now} WHERE id = ${input.id}`;
          else
            yield* sql`INSERT INTO workspace_goals (id, content_json, revision, created_at, updated_at) VALUES (${input.id}, ${encoded}, 1, ${now}, ${now})`;
          return { status: "saved" as const, goal: yield* read(input) };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError((cause) => new WorkspaceGoalError({ operation: "write", cause })),
    Effect.uninterruptible,
  );

  const addProgress = Effect.fn("WorkspaceGoals.addProgress")(
    function* (raw: WorkspaceGoalProgressInput, source: "user" | "agent") {
      const input = yield* decodeProgress(raw);
      const goal = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* read(input);
          if (!current) return null;
          const duplicate =
            yield* sql`SELECT text FROM workspace_goal_updates WHERE goal_id = ${input.id} AND update_id = ${input.updateId}`;
          if (duplicate.length > 0) {
            if (duplicate[0]?.text !== input.text)
              return yield* new WorkspaceGoalError({
                operation: "write",
                cause: new Error("Progress update id already used"),
              });
            return current;
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`INSERT INTO workspace_goal_updates (goal_id, update_id, text, source, created_at) VALUES (${input.id}, ${input.updateId}, ${input.text}, ${source}, ${now})`;
          yield* sql`UPDATE workspace_goals SET revision = revision + 1, updated_at = ${now} WHERE id = ${input.id}`;
          return yield* read(input);
        }),
      );
      if (goal) yield* PubSub.publish(changes, undefined);
      return goal;
    },
    Effect.mapError((cause) => new WorkspaceGoalError({ operation: "write", cause })),
    Effect.uninterruptible,
  );

  const history = Effect.fn("WorkspaceGoals.history")(
    function* (raw: WorkspaceGoalHistoryInput) {
      const input = yield* decodeHistoryInput(raw);
      const updates =
        yield* sql`SELECT update_id AS id, sequence, text, source, created_at AS "createdAt" FROM workspace_goal_updates
      WHERE goal_id = ${input.id} AND ${input.beforeSequence === undefined ? sql`1 = 1` : sql`sequence < ${input.beforeSequence}`} ORDER BY sequence DESC LIMIT 21`;
      return yield* decodeHistory({
        updates: updates.slice(0, 20),
        nextBeforeSequence: updates.length > 20 ? updates[19]?.sequence : null,
      });
    },
    Effect.mapError((cause) => new WorkspaceGoalError({ operation: "read", cause })),
  );

  return WorkspaceGoals.of({
    list,
    read,
    write,
    addProgress,
    history,
    summaries: Effect.fn("WorkspaceGoals.summaries")(function* () {
      return (yield* list()).goals.map(({ id, content, revision, latestUpdate }) => ({
        id,
        title: content.title,
        kind: content.kind,
        status: content.status,
        nextStep: content.nextStep,
        targetDate: content.targetDate,
        revision,
        latestUpdate,
      }));
    }),
    subscribe: () =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribe before reading so a concurrent change cannot be missed.
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(list()),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(list)),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(WorkspaceGoals, make);
