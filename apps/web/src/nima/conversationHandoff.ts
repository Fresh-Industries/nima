import { create } from "zustand";
import { randomUUID } from "../lib/utils";

type ConversationRequest = {
  id: string;
  prompt: string;
  targetKey: string | null;
  phase: "pending" | "placed";
};

// A click can hand off to chat, but must not restart a conversation after a browser reload.
export const useConversationHandoffStore = create<{
  request: ConversationRequest | null;
  begin: (prompt: string) => void;
  claim: (id: string, targetKey: string) => void;
  place: (id: string, targetKey: string) => void;
  dismiss: (id: string) => void;
}>((set) => ({
  request: null,
  begin: (prompt) =>
    set({ request: { id: randomUUID(), prompt, targetKey: null, phase: "pending" } }),
  claim: (id, targetKey) =>
    set((state) =>
      state.request?.id === id ? { request: { ...state.request, targetKey } } : state,
    ),
  place: (id, targetKey) =>
    set((state) =>
      state.request?.id === id
        ? { request: { ...state.request, targetKey, phase: "placed" } }
        : state,
    ),
  dismiss: (id) => set((state) => (state.request?.id === id ? { request: null } : state)),
}));
