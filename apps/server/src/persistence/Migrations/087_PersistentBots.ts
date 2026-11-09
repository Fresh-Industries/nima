import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_bots (
    bot_id TEXT PRIMARY KEY NOT NULL,
    description TEXT NOT NULL,
    config_json TEXT NOT NULL,
    model_selection_json TEXT,
    thread_id TEXT UNIQUE,
    generation INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
  )`;
  yield* sql`INSERT INTO workspace_bots(bot_id,description,config_json,thread_id,generation,revision,updated_at)
    SELECT 'primary','Your everyday assistant',config_json,thread_id,generation,revision,updated_at FROM personal_agent WHERE id=1`;
  // Preserve the original row; existing review views read a compatibility view of the shared identity.
  const [work] = yield* sql<{
    sql: string;
  }>`SELECT sql FROM sqlite_master WHERE type='view' AND name='workspace_assistant_work'`;
  const [review] = yield* sql<{
    sql: string;
  }>`SELECT sql FROM sqlite_master WHERE type='view' AND name='workspace_review_items'`;
  yield* sql`DROP VIEW workspace_review_items`;
  yield* sql`DROP VIEW workspace_assistant_work`;
  yield* sql`ALTER TABLE personal_agent RENAME TO personal_agent_legacy`;
  yield* sql`CREATE VIEW personal_agent AS SELECT 1 AS id,config_json,thread_id,generation,revision,updated_at FROM workspace_bots WHERE bot_id='primary'`;
  if (work) yield* sql.unsafe(work.sql);
  if (review) yield* sql.unsafe(review.sql);
});
