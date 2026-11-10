import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  StudioReadInput,
  StudioMutationInput,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";
import * as Schema from "effect/Schema";
import * as Studio from "../../../studio/Studio.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    Studio.Studio,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
};
export const StudioToolkit = Toolkit.make(
  Tool.make("t3_studio_inspect", {
    ...shared,
    description:
      "Inspect Bara's built-in creative Studio on the selected environment, the default destination for editable canvases, mockups, photo edits and storyboards unless the user requests another service. Read before editing with t3_studio_edit. If available=false, report the limitation; do not silently substitute Figma or claim an external result is in Bara. scope=studio lists saved projects, workspaces, originals and revision; scope=artwork requires an artwork asset id and returns editable nodes/revision; scope=live reads the saved scene collection; scope=capabilities lists supported native operations and limits. Image bytes and generated SVG are omitted from agent responses. The native Rust engine remains authoritative.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...StudioReadInput.fields,
    }),
    success: Schema.Json,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_studio_edit", {
    ...shared,
    description:
      "Edit Bara Studio using the existing Rust engine. Requires full access. Read first and use its exact expectedRevision plus a new stable requestId. operation=create with area=design/photo/story/live creates work; artwork applies payload={type:'edit',commands:[...]} or undo/redo to an artwork asset id. studio applies catalog, Story and Motion actions; live applies native Live edits. Commands use native snake_case fields; artwork examples: add with node, set_bounds with id/bounds, set_fill with id/fill RGBA, set_text, set_mask. Conflicts preserve saved work; inspect again rather than overwriting. External paths, account sync and device/broadcast consent cannot be changed through this tool.",
    parameters: Schema.Struct({
      environmentId: OrchestratorMcpEnvironmentTarget,
      ...StudioMutationInput.fields,
    }),
    success: Schema.Json,
  }).annotate(Tool.Destructive, true),
);
