import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE personal_agent (
    id INTEGER PRIMARY KEY CHECK(id = 1), config_json TEXT NOT NULL,
    thread_id TEXT, generation INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT
  )`;
  yield* sql`INSERT INTO personal_agent(id,config_json) VALUES(1,
    '{"name":"Citrus","avatar":"🍊","timezone":"UTC","reasoning":"xhigh","instructions":"","personalMemoryTaskIds":[]}')`;
  yield* sql`CREATE TABLE assistant_memory (
    scope_kind TEXT NOT NULL CHECK(scope_kind IN ('personal','project','thread')),
    resource_id TEXT NOT NULL, fact_key TEXT NOT NULL, content TEXT NOT NULL,
    sources_json TEXT NOT NULL, forgotten INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(scope_kind,resource_id,fact_key)
  )`;
  yield* sql`CREATE TABLE assistant_memory_exposure (
    thread_id TEXT PRIMARY KEY NOT NULL, private_context INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE TABLE assistant_memory_job_runs (
    message_id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL
  )`;
});
