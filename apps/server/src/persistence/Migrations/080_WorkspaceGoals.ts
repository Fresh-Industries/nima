import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_goals (
    id TEXT PRIMARY KEY NOT NULL,
    content_json TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE workspace_goal_updates (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id TEXT NOT NULL REFERENCES workspace_goals(id) ON DELETE CASCADE,
    update_id TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('user', 'agent')),
    created_at TEXT NOT NULL,
    UNIQUE (goal_id, update_id)
  )`;
  yield* sql`CREATE INDEX idx_workspace_goal_updates_history ON workspace_goal_updates(goal_id, sequence DESC)`;
});
