import {
  WorkspaceReviewError,
  WorkspaceReviewItem,
  WorkspaceReviewSnapshot,
  WorkspaceReviewReadInput,
  WorkspaceReviewWriteInput,
  WorkspaceThreadMetadata,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";

export class WorkspaceReview extends Context.Service<
  WorkspaceReview,
  {
    readonly read: (
      input: WorkspaceReviewReadInput,
    ) => Effect.Effect<WorkspaceReviewSnapshot, WorkspaceReviewError>;
    readonly write: (input: WorkspaceReviewWriteInput) => Effect.Effect<{}, WorkspaceReviewError>;
    readonly subscribe: (
      input: WorkspaceReviewReadInput,
    ) => Stream.Stream<WorkspaceReviewSnapshot, WorkspaceReviewError>;
  }
>()("t3/workspace/WorkspaceReview") {}

const threadIdsJson = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const decodeRead = Schema.decodeUnknownEffect(WorkspaceReviewReadInput);
const decodeWrite = Schema.decodeUnknownEffect(WorkspaceReviewWriteInput);
const decodeItems = Schema.decodeUnknownEffect(Schema.Array(WorkspaceReviewItem));
const decodeMetadata = Schema.decodeUnknownEffect(Schema.Array(WorkspaceThreadMetadata));
const isReviewError = Schema.is(WorkspaceReviewError);
const failure = (reason: "read" | "write") => (cause: unknown) =>
  isReviewError(cause) ? cause : new WorkspaceReviewError({ reason, cause });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const events = yield* EventSinkV2;
  const changes = yield* PubSub.sliding<void>(1);
  const read = Effect.fn("WorkspaceReview.read")(
    function* (raw: WorkspaceReviewReadInput) {
      const input = yield* decodeRead(raw);
      const rows =
        yield* sql`SELECT review.key, review.version, review.kind, review.threadId, review.runId, review.botId, COALESCE(checkin.goal_id, bot.goal_id) AS goalId, review.title, review.summary, review.completedAt, review.status, review.state
      FROM workspace_review_items AS review
      LEFT JOIN scheduled_tasks AS bot ON bot.task_id = review.botId
      LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = review.runId
      LEFT JOIN workspace_goal_checkin_messages AS checkin ON checkin.message_id = json_extract(run.payload_json, '$.userMessageId')
      WHERE review.state = ${input.view}
        AND (${input.before === undefined ? 1 : 0} = 1 OR completedAt < ${input.before?.at ?? ""}
          OR (completedAt = ${input.before?.at ?? ""} AND key < ${input.before?.key ?? ""}))
      ORDER BY completedAt DESC, key DESC LIMIT 51`;
      const items = yield* decodeItems(rows.slice(0, 50));
      const [count] = yield* sql<{
        count: number;
      }>`SELECT count(*) AS count FROM workspace_review_items WHERE state = 'review'`;
      const metadata = input.threadIds.length
        ? yield* sql<{
            latestRunIsBot: number;
            assistantWork: number;
            assistantWorkPending: number;
            workPending: number;
          }>`SELECT thread.thread_id AS threadId,
      CASE WHEN work.thread_id IS NOT NULL THEN 1 ELSE 0 END AS assistantWork,
      COALESCE(work.busy,0) AS assistantWorkPending,
      COALESCE(activity.busy,0) AS workPending, meta.coordinator_bot_id AS coordinatorBotId,
      CASE WHEN meta.configuration_revision>0 THEN meta.scope_project_id ELSE thread.project_id END AS scopeProjectId,
      COALESCE(meta.configuration_revision,0) AS configurationRevision,
      COALESCE(meta.kind, CASE WHEN work.thread_id IS NOT NULL THEN 'focus' ELSE NULL END) AS kind, meta.title AS title, meta.objective AS objective, CASE WHEN work.busy=1 OR activity.busy=1 THEN 'active' ELSE COALESCE(item.state, mark.state) END AS state, COALESCE(item.version, mark.version) AS version,
      CASE WHEN json_extract(source.payload_json, '$.scheduledTaskId') IS NOT NULL THEN 1 ELSE 0 END AS latestRunIsBot
      FROM orchestration_v2_projection_threads AS thread
      LEFT JOIN workspace_thread_metadata AS meta ON meta.thread_id = thread.thread_id
      LEFT JOIN workspace_assistant_work AS work ON work.thread_id = thread.thread_id
      LEFT JOIN workspace_work_activity AS activity ON activity.thread_id = thread.thread_id
      LEFT JOIN workspace_review_marks AS mark ON mark.item_key = 'focus:' || thread.thread_id
      LEFT JOIN workspace_review_items AS item ON item.key = 'focus:' || thread.thread_id
      LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = (
        SELECT latest.run_id FROM orchestration_v2_projection_runs AS latest WHERE latest.thread_id = thread.thread_id ORDER BY latest.ordinal DESC LIMIT 1)
      LEFT JOIN orchestration_v2_projection_messages AS source ON source.message_id = json_extract(run.payload_json, '$.userMessageId')
      WHERE thread.thread_id IN (SELECT value FROM json_each(${threadIdsJson(input.threadIds)})) AND thread.deleted_at IS NULL`
        : [];
      const last = items.at(-1);
      return {
        items,
        pendingCount: count?.count ?? 0,
        metadata: yield* decodeMetadata(
          metadata.map((row) => ({
            ...row,
            workPending: row.workPending === 1,
            assistantWork: row.assistantWork === 1,
            assistantWorkPending: row.assistantWorkPending === 1,
            latestRunIsBot: row.latestRunIsBot === 1,
          })),
        ),
        nextCursor: rows.length > 50 && last ? { at: last.completedAt, key: last.key } : null,
      };
    },
    sql.withTransaction,
    Effect.mapError(failure("read")),
  );

  const requireThread = Effect.fn("WorkspaceReview.requireThread")(function* (id: ThreadId) {
    const rows =
      yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id = ${id} AND deleted_at IS NULL AND archived_at IS NULL`;
    if (!rows.length) return yield* new WorkspaceReviewError({ reason: "unavailable" });
  });
  const requireIdle = Effect.fn("WorkspaceReview.requireIdle")(function* (id: ThreadId) {
    const [active] = yield* sql<{
      busy: number;
    }>`SELECT busy FROM workspace_work_activity WHERE thread_id=${id}`;
    if (active?.busy === 1) return yield* new WorkspaceReviewError({ reason: "busy" });
  });
  const coordinate = Effect.fn("WorkspaceReview.coordinate")(function* (
    input: Extract<WorkspaceReviewWriteInput, { action: "coordinate" }>,
  ) {
    yield* requireThread(input.threadId);
    const [relationship] =
      yield* sql`SELECT bot_id FROM workspace_bots WHERE thread_id=${input.threadId}`;
    const [thread] = yield* sql<{
      project_id: string;
      title: string;
    }>`SELECT project_id,title FROM orchestration_v2_projection_threads WHERE thread_id=${input.threadId}`;
    const [current] = yield* sql<{
      kind: string;
      configuration_revision: number;
      coordinator_bot_id: string | null;
      scope_project_id: string | null;
    }>`SELECT kind,configuration_revision,coordinator_bot_id,scope_project_id FROM workspace_thread_metadata WHERE thread_id=${input.threadId}`;
    if (relationship || current?.kind === "assistant" || !thread)
      return yield* new WorkspaceReviewError({ reason: "unavailable" });
    if ((current?.configuration_revision ?? 0) !== input.expectedRevision)
      return yield* new WorkspaceReviewError({ reason: "configuration-changed" });
    if (input.coordinatorBotId !== null) {
      const [bot] = yield* sql<{
        archived: number;
      }>`SELECT archived FROM workspace_bots WHERE bot_id=${input.coordinatorBotId}`;
      if (!bot || (bot.archived === 1 && current?.coordinator_bot_id !== input.coordinatorBotId))
        return yield* new WorkspaceReviewError({ reason: "unavailable" });
      const scope =
        current && current.configuration_revision > 0
          ? current.scope_project_id
          : thread.project_id;
      if (scope !== null) {
        const [allowed] =
          yield* sql`SELECT bot_id FROM workspace_bots WHERE bot_id=${input.coordinatorBotId} AND (json_type(capabilities_json,'$.toolPolicy.projectIds')='null' OR EXISTS(SELECT 1 FROM json_each(capabilities_json,'$.toolPolicy.projectIds') WHERE value=${scope}))`;
        if (!allowed) return yield* new WorkspaceReviewError({ reason: "unavailable" });
      }
    }
    yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,scope_project_id) VALUES(${input.threadId},'focus',${thread.title},'',${DateTime.formatIso(yield* DateTime.now)},${thread.project_id}) ON CONFLICT(thread_id) DO NOTHING`;
    yield* requireIdle(input.threadId);
    yield* sql`UPDATE workspace_thread_metadata SET coordinator_bot_id=${input.coordinatorBotId},scope_project_id=CASE WHEN configuration_revision=0 THEN ${thread.project_id} ELSE scope_project_id END,configuration_revision=configuration_revision+1,updated_at=${DateTime.formatIso(yield* DateTime.now)} WHERE thread_id=${input.threadId}`;
  });
  const mark = Effect.fn("WorkspaceReview.mark")(function* (
    key: string,
    threadId: ThreadId,
    version: string,
    state: "review" | "settled" | "active",
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* sql`INSERT INTO workspace_review_marks (item_key, thread_id, version, state, updated_at) VALUES (${key}, ${threadId}, ${version}, ${state}, ${at})
      ON CONFLICT(item_key) DO UPDATE SET version = excluded.version, state = excluded.state, updated_at = excluded.updated_at`;
  });
  const request = Effect.fn("WorkspaceReview.request")(function* (threadId: ThreadId) {
    yield* requireThread(threadId);
    yield* requireIdle(threadId);
    const [run] = yield* sql<{
      run_id: string;
    }>`SELECT run.run_id FROM orchestration_v2_projection_runs AS run
      JOIN orchestration_v2_projection_messages AS message ON message.message_id = json_extract(run.payload_json, '$.userMessageId')
      WHERE run.thread_id = ${threadId} AND json_extract(message.payload_json, '$.scheduledTaskId') IS NULL ORDER BY run.ordinal DESC LIMIT 1`;
    yield* mark(`focus:${threadId}`, threadId, run?.run_id ?? "manual", "review");
    const [item] =
      yield* sql`SELECT key FROM workspace_review_items WHERE key=${`focus:${threadId}`} AND state='review'`;
    if (!item) return yield* new WorkspaceReviewError({ reason: "unavailable" });
  });
  const write = Effect.fn("WorkspaceReview.write")(
    function* (raw: WorkspaceReviewWriteInput) {
      const input = yield* decodeWrite(raw);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          if (input.action === "coordinate") yield* coordinate(input);
          else if (input.action === "remember") {
            yield* requireThread(input.threadId);
            const at = DateTime.formatIso(yield* DateTime.now);
            const inserted =
              yield* sql`INSERT INTO workspace_thread_metadata (thread_id, kind, title, objective, updated_at)
          VALUES (${input.threadId}, ${input.kind}, ${input.title}, ${input.objective}, ${at})
          ON CONFLICT(thread_id) DO NOTHING RETURNING thread_id`;
            if (inserted.length && input.review && input.kind === "focus")
              yield* request(input.threadId);
          } else if (input.action === "request") yield* request(input.threadId);
          else {
            const [current] = yield* decodeItems(
              yield* sql`SELECT key, version, kind, threadId, runId, botId, title, summary, completedAt, status, state FROM workspace_review_items WHERE key = ${input.key}`,
            );
            if (!current) return yield* new WorkspaceReviewError({ reason: "unavailable" });
            if (current.version !== input.version)
              return yield* new WorkspaceReviewError({ reason: "changed" });
            yield* mark(
              current.key,
              current.threadId,
              current.version,
              input.action === "settle"
                ? "settled"
                : current.kind === "focus"
                  ? "active"
                  : "review",
            );
          }
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return {};
    },
    Effect.mapError(failure("write")),
    Effect.uninterruptible,
  );

  return WorkspaceReview.of({
    read,
    write,
    subscribe: (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const latest = yield* events.latestSequence().pipe(Effect.mapError(failure("read")));
          const lifecycle = events.stream({ afterSequence: latest }).pipe(
            Stream.filter(
              ({ event }) =>
                event.type === "run.updated" ||
                event.type === "run.created" ||
                event.type === "subagent.updated" ||
                event.type === "provider-thread.updated" ||
                event.type.startsWith("thread.") ||
                (event.type === "message.updated" && !event.payload.streaming),
            ),
            Stream.map(() => undefined),
            Stream.mapError(failure("read")),
          );
          return Stream.concat(
            Stream.fromEffect(read(input)),
            Stream.merge(Stream.fromSubscription(subscription), lifecycle).pipe(
              Stream.debounce("30 millis"),
              Stream.mapEffect(() => read(input)),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(WorkspaceReview, make);
