import type { EnvironmentId } from "@t3tools/contracts";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useQuietThreadProjection } from "../../state/entities";
import { deriveThreadActivityRun } from "@t3tools/client-runtime/state/thread-execution";
import { studioChatActivity } from "./chatActivity";

export function StudioChatStatus({
  environmentId,
  assetId,
  revision,
  localStatus,
}: {
  environmentId: EnvironmentId | null;
  assetId: string;
  revision: number;
  localStatus?: string | undefined;
}) {
  const route = useThreadRouteTarget();
  const ref =
    route?.kind === "server" && route.threadRef.environmentId === environmentId
      ? route.threadRef
      : null;
  const thread = useQuietThreadProjection(ref)?.projection;
  const activity =
    environmentId && ref && thread
      ? studioChatActivity(thread.visibleTurnItems, {
          environmentId,
          threadId: ref.threadId,
          runId: deriveThreadActivityRun(thread)?.runId ?? null,
          assetId,
          revision,
        })
      : null;
  return <span role="status">{localStatus ?? activity ?? "All changes saved"}</span>;
}
