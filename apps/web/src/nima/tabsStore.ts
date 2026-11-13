import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type WorkspaceTab =
  | { id: string; kind: "thread"; environmentId: EnvironmentId; threadId: ThreadId; title: string }
  | { id: string; kind: "app"; app: string };

const LIMIT = 10;

/** The conversations and apps you have open, in the order you opened them. Per browser. */
export const useTabsStore = create<{
  tabs: WorkspaceTab[];
  open: (tab: WorkspaceTab) => void;
  close: (id: string) => void;
}>()(
  persist(
    (set) => ({
      tabs: [],
      open: (tab) =>
        set((state) => {
          const at = state.tabs.findIndex((entry) => entry.id === tab.id);
          if (at >= 0) {
            const current = state.tabs[at]!;
            if (current.kind !== "thread" || tab.kind !== "thread" || current.title === tab.title)
              return state;
            return { tabs: state.tabs.with(at, tab) };
          }
          // Beyond the limit the oldest tab makes room, as nothing here is lost by closing.
          return { tabs: [...state.tabs, tab].slice(-LIMIT) };
        }),
      close: (id) => set((state) => ({ tabs: state.tabs.filter((tab) => tab.id !== id) })),
    }),
    { name: "bara.tabs", storage: createJSONStorage(() => localStorage) },
  ),
);
