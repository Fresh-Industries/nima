import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE workspace_bots ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{"toolPolicy":{"rules":[],"projectIds":null},"skillPageIds":[],"fallbackModels":[],"recallRelationship":false,"maxRunMinutes":null,"maxReportedTokens":null}'`;
  yield* sql`CREATE TABLE workspace_bot_approvals (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, bot_names_json TEXT NOT NULL,
    policy_json TEXT NOT NULL, tool TEXT NOT NULL, arguments_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','consumed','invalidated')),
    revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX workspace_bot_approvals_pending ON workspace_bot_approvals(status,expires_at)`;
});
