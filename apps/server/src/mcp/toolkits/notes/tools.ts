import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  WorkspaceNote,
  WorkspaceNoteWriteInput,
  WorkspaceNoteWriteResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as WorkspaceNotes from "../../../workspace/WorkspaceNotes.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    WorkspaceNotes.WorkspaceNotes,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};

export const NotesToolkit = Toolkit.make(
  Tool.make("t3_notes_read", {
    ...shared,
    description:
      "Read the user's shared Bara Markdown notepad and its revision. Read before editing; it is shared across conversations and browsers.",
    parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
    success: WorkspaceNote,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_notes_write", {
    ...shared,
    description:
      "Save the shared Bara Markdown notepad. Requires full access and expectedRevision from t3_notes_read. Preserve unrelated notes. A conflict returns the current note; reconcile and retry with its revision. Never overwrite concurrent edits blindly.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspaceNoteWriteInput.fields,
    }),
    success: WorkspaceNoteWriteResult,
  }).annotate(Tool.Destructive, true),
);
