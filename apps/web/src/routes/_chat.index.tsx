import { createFileRoute, Navigate } from "@tanstack/react-router";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { useEnvironments } from "../state/environments";

function Home() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }
  // The Desk is home; the Assistant lives in its dock on every page.
  return <Navigate to="/work" replace />;
}
export const Route = createFileRoute("/_chat/")({ component: Home });
