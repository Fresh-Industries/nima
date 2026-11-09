import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE workspace_thread_metadata ADD COLUMN coordinator_bot_id TEXT REFERENCES workspace_bots(bot_id)`;
  yield* sql`ALTER TABLE workspace_thread_metadata ADD COLUMN scope_project_id TEXT`;
  yield* sql`ALTER TABLE workspace_thread_metadata ADD COLUMN configuration_revision INTEGER NOT NULL DEFAULT 0`;
  yield* sql`CREATE VIEW workspace_work_activity AS SELECT thread.thread_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM orchestration_v2_projection_runs run WHERE run.thread_id = thread.thread_id
          AND run.status IN ('preparing','queued','starting','running','waiting')
          AND NOT (run.status = 'queued' AND COALESCE(json_extract(run.payload_json, '$.queueHeld'),0) = 1)
      ) OR EXISTS (
        SELECT 1 FROM orchestration_v2_projection_subagents nested WHERE nested.thread_id = thread.thread_id
          AND (nested.status IN ('pending','running','waiting') OR (nested.status <> 'idle'
            AND json_extract(nested.payload_json, '$.completionDelivery.state') IN ('pending','claimed')))
      ) OR EXISTS (
        SELECT 1 FROM orchestration_v2_projection_provider_threads provider,
          json_each(provider.payload_json, '$.pendingBackgroundTasks') background
        WHERE provider.thread_id = thread.thread_id AND
          (json_extract(background.value, '$.awaited') = 1
            OR json_extract(background.value, '$.kind') IN ('subagent','background_task'))
      ) THEN 1 ELSE 0 END AS busy
    FROM orchestration_v2_projection_threads thread
    JOIN workspace_thread_metadata meta ON meta.thread_id=thread.thread_id AND meta.kind='focus'
    WHERE thread.deleted_at IS NULL`;
  const [review] = yield* sql<{
    sql: string;
  }>`SELECT sql FROM sqlite_master WHERE type='view' AND name='workspace_review_items'`;
  if (review) {
    yield* sql`DROP VIEW workspace_review_items`;
    yield* sql.unsafe(
      review.sql.replace(
        "CREATE VIEW workspace_review_items",
        "CREATE VIEW workspace_review_results",
      ),
    );
    yield* sql`CREATE VIEW workspace_review_items AS SELECT result.* FROM workspace_review_results result
      WHERE NOT EXISTS (SELECT 1 FROM workspace_work_activity activity WHERE activity.thread_id=result.threadId AND activity.busy=1)`;
  }
});
