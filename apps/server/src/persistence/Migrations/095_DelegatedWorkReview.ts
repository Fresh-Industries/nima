import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

const ASSISTANT_ONLY =
  "OR EXISTS (SELECT 1 FROM workspace_assistant_work work WHERE work.thread_id = thread.thread_id))";

// Work a session delegates directly is its own Work session on the Desk, so it reaches the
// Inbox like one. Deeper work stays inside the session that started it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [results] = yield* sql<{
    sql: string;
  }>`SELECT sql FROM sqlite_master WHERE type='view' AND name='workspace_review_results'`;
  if (!results?.sql.includes(ASSISTANT_ONLY)) return;
  yield* sql`DROP VIEW workspace_review_results`;
  yield* sql.unsafe(
    results.sql.replaceAll(
      ASSISTANT_ONLY,
      `${ASSISTANT_ONLY.slice(0, -1)}
          OR EXISTS (SELECT 1 FROM workspace_bot_delegations delegated WHERE delegated.thread_id = thread.thread_id AND delegated.depth = 1))`,
    ),
  );
});
