import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The create form once prefilled "New bot", so Bots made by typing only a responsibility all
// share that name. They take the start of their responsibility instead.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    bot_id: string;
    description: string;
  }>`SELECT bot_id, description FROM workspace_bots WHERE json_extract(config_json,'$.name')='New bot' AND trim(description)<>''`;
  for (const row of rows) {
    const words = row.description.trim().split(/\s+/).slice(0, 2).join(" ");
    const name = (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
    yield* sql`UPDATE workspace_bots SET config_json=json_set(config_json,'$.name',${name}), revision=revision+1 WHERE bot_id=${row.bot_id}`;
  }
});
