import { createContext, use } from "react";
import type { BotProfile } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

export function useBots(target?: EnvironmentId) {
  const primary = usePrimaryEnvironmentId();
  const environmentId = target ?? primary;
  const environment = useEnvironment(environmentId);
  const query = useEnvironmentQuery(
    environmentId && environment?.serverConfig?.environment.capabilities.botCapabilities
      ? serverEnvironment.botsLive({ environmentId, input: {} })
      : null,
  );
  return {
    environmentId,
    bots: query.data?.bots ?? [],
    approvals: query.data?.approvals ?? [],
    query,
    connected: environment?.connection.phase === "connected",
  };
}

export const BotConversationContext = createContext<BotProfile | null>(null);
export function useBotConversation() {
  return use(BotConversationContext);
}
