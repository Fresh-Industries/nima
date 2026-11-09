import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_notes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    markdown TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at TEXT
  )`;
  yield* sql`INSERT INTO workspace_notes (id, markdown, revision) VALUES (1, '', 0)`;
});
