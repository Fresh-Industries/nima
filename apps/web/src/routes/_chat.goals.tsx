import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { Goals } from "../nima/Goals";
export const Route = createFileRoute("/_chat/goals")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.goalId === "string" && raw.goalId.trim() ? { goalId: raw.goalId.trim() } : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId.trim()) }
      : {}),
  }),
  component: GoalsRoute,
});
function GoalsRoute() {
  return <Goals {...Route.useSearch()} />;
}
