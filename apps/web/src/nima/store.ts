import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "../composerDraftStore";

export type PlanTask = { id: string; text: string; done: boolean };
export type DayPlan = { notes: string; tasks: PlanTask[] };
export type DailyConversation = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId: DraftId;
};
export type FocusMetadata = { title: string; objective: string; review: boolean };
export const EMPTY_PLAN: DayPlan = { notes: "", tasks: [] };

export function localDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find((value) => value.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function moveTask(tasks: PlanTask[], id: string, direction: -1 | 1): PlanTask[] {
  const index = tasks.findIndex((task) => task.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= tasks.length) return tasks;
  const result = [...tasks];
  [result[index], result[destination]] = [result[destination]!, result[index]!];
  return result;
}

interface NimaState {
  chiefName: string;
  timezone: string;
  plans: Record<string, DayPlan>;
  daily: Record<string, DailyConversation>;
  focus: Record<string, FocusMetadata>;
  utilityOpen: boolean;
  utilityWidth: number;
  configure: (chiefName: string, timezone: string) => void;
  savePlan: (day: string, plan: DayPlan) => void;
  rememberDaily: (day: string, conversation: DailyConversation) => void;
  rememberFocus: (key: string, focus: FocusMetadata) => void;
  setUtilityOpen: (open: boolean) => void;
  setUtilityWidth: (width: number) => void;
}

export const useNimaStore = create<NimaState>()(
  persist(
    (set) => ({
      chiefName: "Chief of Staff",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      plans: {},
      daily: {},
      focus: {},
      utilityOpen: typeof window !== "undefined" && window.innerWidth >= 1100,
      utilityWidth: 300,
      configure: (chiefName, timezone) => {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions();
        set({ chiefName: chiefName.trim() || "Chief of Staff", timezone });
      },
      savePlan: (day, plan) => set((state) => ({ plans: { ...state.plans, [day]: plan } })),
      rememberDaily: (day, conversation) =>
        set((state) => ({ daily: { ...state.daily, [day]: conversation } })),
      rememberFocus: (key, focus) => set((state) => ({ focus: { ...state.focus, [key]: focus } })),
      setUtilityOpen: (utilityOpen) => set({ utilityOpen }),
      setUtilityWidth: (utilityWidth) => set({ utilityWidth }),
    }),
    { name: "nima:workspace:v1", storage: createJSONStorage(() => localStorage) },
  ),
);
