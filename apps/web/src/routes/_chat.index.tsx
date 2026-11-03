import { createFileRoute } from "@tanstack/react-router";
import { Today } from "../nima/Workspace";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { useEnvironments } from "../state/environments";

function Home() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }
  return <Today />;
}
export const Route = createFileRoute("/_chat/")({ component: Home });
