import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN goal_id TEXT`;
  yield* sql`CREATE INDEX scheduled_tasks_goal_idx ON scheduled_tasks(goal_id)`;
  yield* sql`CREATE TABLE workspace_goal_checkin_messages (
    message_id TEXT PRIMARY KEY NOT NULL, goal_id TEXT NOT NULL, task_id TEXT NOT NULL
  )`;
});
