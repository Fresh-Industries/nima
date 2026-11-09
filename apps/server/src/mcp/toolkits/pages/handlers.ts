import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as WorkspacePages from "../../../workspace/WorkspacePages.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PagesToolkit } from "./tools.ts";

const failure = (cause: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: cause.message });
export const layer = McpToolAccess.toLayer(PagesToolkit, {
  t3_pages_list: McpToolAccess.reads((input) =>
    Effect.flatMap(WorkspacePages.WorkspacePages, (pages) =>
      pages.list(input).pipe(Effect.mapError(failure)),
    ),
  ),
  t3_pages_read: McpToolAccess.reads((input) =>
    Effect.flatMap(WorkspacePages.WorkspacePages, (pages) =>
      pages.read(input).pipe(Effect.mapError(failure)),
    ),
  ),
  t3_pages_write: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(WorkspacePages.WorkspacePages, (pages) =>
      pages.write(input).pipe(Effect.mapError(failure)),
    ),
  ),
});
