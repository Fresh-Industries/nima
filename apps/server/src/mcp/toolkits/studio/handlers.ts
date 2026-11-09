import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Studio from "../../../studio/Studio.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { StudioToolkit } from "./tools.ts";
const failure = (cause: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: cause.message });
function metadata(value: Schema.Json): Schema.Json {
  if (Array.isArray(value)) return value.map(metadata);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        key === "png_base64" ? "[stored image bytes omitted]" : metadata(value),
      ]),
    );
  return value;
}
export const layer = McpToolAccess.toLayer(StudioToolkit, {
  t3_studio_inspect: McpToolAccess.reads((input) =>
    Effect.flatMap(Studio.Studio, (studio) =>
      studio.read(input).pipe(
        Effect.map((snapshot) =>
          metadata({
            available: snapshot.available,
            message: snapshot.message,
            data: snapshot.data,
          }),
        ),
        Effect.mapError(failure),
      ),
    ),
  ),
  t3_studio_edit: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(Studio.Studio, (studio) =>
      studio.mutate(input).pipe(Effect.map(metadata), Effect.mapError(failure)),
    ),
  ),
});
