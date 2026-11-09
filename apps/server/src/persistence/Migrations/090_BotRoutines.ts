import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN owner_bot_id TEXT REFERENCES workspace_bots(bot_id)`;
  yield* sql`CREATE INDEX scheduled_tasks_owner_bot ON scheduled_tasks(owner_bot_id)`;
});
