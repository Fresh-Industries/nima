import { createFileRoute } from "@tanstack/react-router";
import { BotId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ConversationList } from "../nima/Workspace";
export const Route = createFileRoute("/_chat/work")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(raw.view === "projects" ? { view: "projects" as const } : {}),
    ...(typeof raw.projectId === "string" && raw.projectId.trim()
      ? { projectId: ProjectId.make(raw.projectId) }
      : {}),
    ...(typeof raw.botId === "string" && raw.botId.trim() ? { botId: BotId.make(raw.botId) } : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
  }),
  component: WorkRoute,
});
function WorkRoute() {
  return <ConversationList {...Route.useSearch()} />;
}
