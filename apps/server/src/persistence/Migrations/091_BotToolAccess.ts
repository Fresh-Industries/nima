import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE workspace_bots ADD COLUMN tool_access TEXT NOT NULL DEFAULT 'allowed' CHECK(tool_access IN ('allowed','read-only','blocked'))`;
  // Keep an authority reference when a deleted relationship conversation is replaced.
  yield* sql`UPDATE workspace_thread_metadata SET coordinator_bot_id=(SELECT bot_id FROM workspace_bots WHERE workspace_bots.thread_id=workspace_thread_metadata.thread_id) WHERE kind='assistant' AND EXISTS(SELECT 1 FROM workspace_bots WHERE workspace_bots.thread_id=workspace_thread_metadata.thread_id)`;
});
