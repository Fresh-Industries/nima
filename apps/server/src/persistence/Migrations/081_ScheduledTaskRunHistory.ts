import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX idx_messages_scheduled_task_history
    ON orchestration_v2_projection_messages(
      json_extract(payload_json, '$.scheduledTaskId'), created_at DESC, message_id DESC
    ) WHERE role = 'user'`;
});
