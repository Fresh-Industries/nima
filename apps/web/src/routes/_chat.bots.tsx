import { createFileRoute } from "@tanstack/react-router";
import { BotId } from "@t3tools/contracts";
import { Bots } from "../nima/Bots";
import { validateScheduledTasksSearch } from "../components/settings/scheduledTasksSettings.logic";
export const Route = createFileRoute("/_chat/bots")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...validateScheduledTasksSearch(raw),
    ...(raw.settings === true ? { settings: true } : {}),
    ...(raw.create === true ? { create: true } : {}),
    ...(typeof raw.botId === "string" && raw.botId.trim() ? { botId: BotId.make(raw.botId) } : {}),
    ...(raw.view === "routines" ? { view: "routines" as const } : {}),
  }),
  component: BotsRoute,
});
function BotsRoute() {
  return <Bots {...Route.useSearch()} />;
}
