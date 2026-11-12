import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_pucko_meetings (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, content_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX workspace_pucko_meetings_owner ON workspace_pucko_meetings(owner, updated_at DESC)`;
  yield* sql`CREATE TABLE workspace_pucko_settings (
    id INTEGER PRIMARY KEY CHECK (id=1), activation_name TEXT NOT NULL
  )`;
  yield* sql`INSERT INTO workspace_pucko_settings VALUES (1, 'Citrus')`;
});
