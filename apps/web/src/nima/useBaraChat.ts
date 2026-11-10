import { use } from "react";
import { BotConversationContext } from "./useBots";
import { usePersonalChat } from "./useDailyConversation";
import { WorkSessionContext } from "./workSessionContext";

/** Bara's conversational surfaces: the everyday assistant, Bot chats and Focus sessions. */
export function useBaraChat() {
  const bot = use(BotConversationContext);
  const workSession = use(WorkSessionContext);
  return usePersonalChat() || bot !== null || workSession;
}
