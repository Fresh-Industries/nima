import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  WorkspacePagesList,
  WorkspacePagesListInput,
  WorkspacePage,
  WorkspacePageReadInput,
  WorkspacePageWriteInput,
  WorkspacePageWriteResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as WorkspacePages from "../../../workspace/WorkspacePages.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    WorkspacePages.WorkspacePages,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};
export const PagesToolkit = Toolkit.make(
  Tool.make("t3_pages_list", {
    ...shared,
    description:
      "Find named Markdown pages in Bara Spaces. Searches titles and full page text. Returns summaries, not page bodies; read a page before editing. Use nextCursor as before for older matches. Archived pages require archived=true.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspacePagesListInput.fields,
    }),
    success: WorkspacePagesList,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_pages_read", {
    ...shared,
    description:
      "Read a saved Bara Spaces page, its full Markdown, source conversation link and revision. Shared across conversations and browsers.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspacePageReadInput.fields,
    }),
    success: Schema.NullOr(WorkspacePage),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_pages_write", {
    ...shared,
    description:
      "Create or update a named Markdown page in Bara Spaces. Requires full access. For a new page use a new id and expectedRevision=0. For edits, read first, preserve unrelated content and source attribution, then use its revision. On conflict reconcile the returned page instead of overwriting blindly. Archive or restore with content.archived. A source links to a real conversation and run; use null when there is no known source. Saving a page does not execute or stop agents.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...WorkspacePageWriteInput.fields,
    }),
    success: WorkspacePageWriteResult,
  }).annotate(Tool.Destructive, true),
);
