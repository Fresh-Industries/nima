import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { Library } from "../nima/Library";
export const Route = createFileRoute("/_chat/spaces")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.pageId === "string" && raw.pageId.trim() ? { pageId: raw.pageId.trim() } : {}),
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId.trim()) }
      : {}),
  }),
  component: LibraryRoute,
});
function LibraryRoute() {
  return <Library {...Route.useSearch()} />;
}
