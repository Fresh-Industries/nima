import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE workspace_project_teams (
    project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0)`;
  yield* sql`CREATE TABLE workspace_project_team_members (
    project_id TEXT NOT NULL REFERENCES workspace_project_teams(project_id),
    bot_id TEXT NOT NULL REFERENCES workspace_bots(bot_id),
    role TEXT NOT NULL DEFAULT '', PRIMARY KEY(project_id,bot_id))`;
  yield* sql`CREATE TABLE workspace_bot_delegations (
    thread_id TEXT PRIMARY KEY, parent_thread_id TEXT NOT NULL, root_thread_id TEXT NOT NULL,
    depth INTEGER NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
    coordinator_bot_id TEXT REFERENCES workspace_bots(bot_id), scope_project_id TEXT,
    title TEXT NOT NULL, objective TEXT NOT NULL)`;
  yield* sql`CREATE INDEX workspace_bot_delegations_root ON workspace_bot_delegations(root_thread_id)`;
});
