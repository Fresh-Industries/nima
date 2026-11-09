import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_pages (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, source_thread_id TEXT, source_run_id TEXT,
    revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX workspace_pages_list_idx ON workspace_pages(archived, updated_at DESC, id DESC)`;
});
