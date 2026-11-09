import { createContext, use } from "react";
export const WorkSessionContext = createContext(false);
export function useWorkSessionConversation() {
  return use(WorkSessionContext);
}
