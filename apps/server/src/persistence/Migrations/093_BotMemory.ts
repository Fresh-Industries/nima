import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE assistant_memory_scoped (
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('personal','project','thread','bot')),
    resource_id TEXT NOT NULL, fact_key TEXT NOT NULL, content TEXT NOT NULL,
    sources_json TEXT NOT NULL, forgotten INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_kind,resource_id,fact_key)
  )`;
  yield* sql`INSERT INTO assistant_memory_scoped SELECT * FROM assistant_memory`;
  yield* sql`DROP TABLE assistant_memory`;
  yield* sql`ALTER TABLE assistant_memory_scoped RENAME TO assistant_memory`;
});
