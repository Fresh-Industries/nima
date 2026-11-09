import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as WorkspaceNotes from "../../../workspace/WorkspaceNotes.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { NotesToolkit } from "./tools.ts";

const failure = (cause: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: cause.message });

export const layer = McpToolAccess.toLayer(NotesToolkit, {
  t3_notes_read: McpToolAccess.reads(() =>
    Effect.flatMap(WorkspaceNotes.WorkspaceNotes, (notes) =>
      notes.read().pipe(Effect.mapError(failure)),
    ),
  ),
  t3_notes_write: McpToolAccess.writesEnvironment((input) =>
    Effect.flatMap(WorkspaceNotes.WorkspaceNotes, (notes) =>
      notes.write(input).pipe(Effect.mapError(failure)),
    ),
  ),
});
