import { usePersonalAssistant } from "./usePersonalAssistant";
import { createContext, use } from "react";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useNimaStore } from "./store";
import { useDay } from "./useDay";

export function useIsDailyConversation() {
  const target = useThreadRouteTarget();
  const day = useDay();
  const personal = usePersonalAssistant();
  const daily = useNimaStore((state) => state.assistantConversation ?? state.daily[day]);
  if (personal.profile?.threadId)
    return Boolean(
      target?.kind === "server" &&
      target.threadRef.environmentId === personal.environmentId &&
      target.threadRef.threadId === personal.profile.threadId,
    );
  return Boolean(
    daily &&
    target &&
    (target.kind === "draft"
      ? target.draftId === daily.draftId
      : target.threadRef.environmentId === daily.environmentId &&
        target.threadRef.threadId === daily.threadId),
  );
}

export const PersonalChatContext = createContext(false);
export function usePersonalChat() {
  return use(PersonalChatContext);
}
