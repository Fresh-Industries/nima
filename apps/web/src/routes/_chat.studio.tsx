import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, type StudioArea } from "@t3tools/contracts";
export const Route = createFileRoute("/_chat/studio")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(["design", "photo", "story", "motion", "live", "recordings"].includes(String(raw.area))
      ? { area: raw.area as StudioArea }
      : {}),
    ...(typeof raw.id === "string" && /^[0-9a-f-]{36}$/i.test(raw.id) ? { id: raw.id } : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId.trim()) }
      : {}),
  }),
  component: StudioRoute,
});
function StudioRoute() {
  // BaraFrame owns Studio so moving it beside chat preserves the same editor and media session.
  return null;
}
