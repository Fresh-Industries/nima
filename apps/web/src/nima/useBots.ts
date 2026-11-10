import { createContext, use } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomCommand } from "../state/use-atom-command";
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

/** Opens or resumes a Bot's saved conversation, creating it only where the caller may. */
export function useOpenBotConversation(environmentId: EnvironmentId | null) {
  const navigate = useNavigate();
  const open = useAtomCommand(serverEnvironment.openBot, { reportFailure: false });
  const canOpen = useAtomValue(serverEnvironment.openBot.permissionAtom(environmentId));
  const openConversation = async (bot: BotProfile): Promise<string | null> => {
    if (!environmentId) return "Connect to your Bara server to open this Bot.";
    let threadId = bot.threadId;
    if (canOpen) {
      const result = await open({ environmentId, input: { id: bot.id } });
      if (result._tag !== "Success") {
        const error = squashAtomCommandFailure(result);
        return error instanceof Error ? error.message : "Could not open this Bot.";
      }
      threadId = result.value.threadId;
    }
    if (threadId)
      await navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
    return null;
  };
  return { openConversation, canOpen };
}
