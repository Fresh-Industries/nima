import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_thread_metadata (
    thread_id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, objective TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE workspace_review_marks (
    item_key TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL,
    version TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX idx_workspace_review_thread ON workspace_review_marks(thread_id)`;
  yield* sql`CREATE VIEW workspace_review_items AS
    WITH outcomes AS (
      SELECT CASE WHEN json_extract(message.payload_json, '$.scheduledTaskId') IS NOT NULL
          THEN 'bot:' || run.run_id ELSE 'focus:' || thread.thread_id END AS key,
        run.run_id AS version,
        CASE WHEN json_extract(message.payload_json, '$.scheduledTaskId') IS NOT NULL THEN 'bot' ELSE 'focus' END AS kind,
        thread.thread_id AS threadId, run.run_id AS runId,
        json_extract(message.payload_json, '$.scheduledTaskId') AS botId,
        CASE WHEN json_extract(message.payload_json, '$.scheduledTaskId') IS NOT NULL
          THEN COALESCE(bot.title, thread.title)
          ELSE COALESCE(NULLIF(meta.title, ''), thread.title) END AS title,
        COALESCE((SELECT substr(json_extract(reply.payload_json, '$.text'), 1, 2000)
          FROM orchestration_v2_projection_messages AS reply
          WHERE reply.thread_id = run.thread_id AND reply.run_id = run.run_id AND reply.role = 'assistant'
          ORDER BY reply.created_at DESC, reply.message_id DESC LIMIT 1), NULLIF(meta.objective, ''), '') AS summary,
        run.completed_at AS completedAt, run.status AS status,
        json_extract(thread.payload_json, '$.settledOverride') AS settledOverride,
        json_extract(thread.payload_json, '$.settledAt') AS settledAt,
        json_extract(thread.payload_json, '$.unsettledAt') AS unsettledAt
      FROM orchestration_v2_projection_runs AS run
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = run.thread_id
      JOIN orchestration_v2_projection_messages AS message ON message.message_id = json_extract(run.payload_json, '$.userMessageId')
      LEFT JOIN workspace_thread_metadata AS meta ON meta.thread_id = thread.thread_id
      LEFT JOIN scheduled_tasks AS bot ON bot.task_id = json_extract(message.payload_json, '$.scheduledTaskId')
      WHERE run.status IN ('completed', 'failed', 'interrupted', 'cancelled') AND run.completed_at IS NOT NULL
        AND thread.deleted_at IS NULL AND thread.archived_at IS NULL
        AND COALESCE(json_extract(thread.payload_json, '$.lineage.relationshipToParent'), 'root') <> 'subagent'
        AND COALESCE(json_extract(thread.payload_json, '$.lineage.sideChat'), 0) = 0
        AND (json_extract(message.payload_json, '$.scheduledTaskId') IS NOT NULL
          OR (meta.kind IS NOT 'assistant' AND run.run_id = (
            SELECT latest.run_id FROM orchestration_v2_projection_runs AS latest
            JOIN orchestration_v2_projection_messages AS source ON source.message_id = json_extract(latest.payload_json, '$.userMessageId')
            WHERE latest.thread_id = run.thread_id AND json_extract(source.payload_json, '$.scheduledTaskId') IS NULL
            ORDER BY latest.ordinal DESC LIMIT 1
          )))
      UNION ALL
      SELECT mark.item_key, 'manual', 'focus', thread.thread_id, NULL, NULL,
        COALESCE(NULLIF(meta.title, ''), thread.title), COALESCE(meta.objective, ''), mark.updated_at, NULL,
        json_extract(thread.payload_json, '$.settledOverride'), json_extract(thread.payload_json, '$.settledAt'), json_extract(thread.payload_json, '$.unsettledAt')
      FROM workspace_review_marks AS mark
      JOIN orchestration_v2_projection_threads AS thread ON thread.thread_id = mark.thread_id
      LEFT JOIN workspace_thread_metadata AS meta ON meta.thread_id = thread.thread_id
      WHERE mark.item_key = 'focus:' || thread.thread_id AND meta.kind IS NOT 'assistant'
        AND thread.deleted_at IS NULL AND thread.archived_at IS NULL
        AND COALESCE(json_extract(thread.payload_json, '$.lineage.relationshipToParent'), 'root') <> 'subagent'
        AND COALESCE(json_extract(thread.payload_json, '$.lineage.sideChat'), 0) = 0
        AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runs AS run WHERE run.thread_id = thread.thread_id)
    )
    SELECT outcomes.*,
      CASE WHEN mark.item_key IS NOT NULL THEN CASE WHEN mark.version <> outcomes.version THEN 'review'
          WHEN outcomes.kind = 'focus' AND outcomes.settledOverride = 'settled' AND outcomes.settledAt > mark.updated_at AND outcomes.settledAt >= outcomes.completedAt THEN 'settled'
          WHEN outcomes.kind = 'focus' AND outcomes.settledOverride = 'active' AND outcomes.unsettledAt > mark.updated_at AND outcomes.unsettledAt >= outcomes.completedAt THEN 'active'
          ELSE mark.state END
        WHEN outcomes.kind = 'focus' AND outcomes.settledOverride = 'settled' AND outcomes.settledAt >= outcomes.completedAt THEN 'settled'
        WHEN outcomes.kind = 'focus' AND outcomes.settledOverride = 'active' AND outcomes.unsettledAt >= outcomes.completedAt THEN 'active'
        ELSE 'review' END AS state
    FROM outcomes LEFT JOIN workspace_review_marks AS mark ON mark.item_key = outcomes.key`;
});
