import { pageRecoveryWorkspaces, type PageWorkspace } from "./pages";
import type { GoalWorkspace } from "./goalWorkspace";
import type { NoteDraft } from "./notes";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { EnvironmentId, StudioArea, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "../composerDraftStore";

export type PlanTask = { id: string; text: string; done: boolean };
export type DayPlan = { notes: string; tasks: PlanTask[] };
export type DailyConversation = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  draftId: DraftId;
};
export type WorkSurface = "Live Stream" | "Browser" | "Studio" | "Notes" | "Files";
export type StudioView = { environmentId: EnvironmentId; area: StudioArea; id?: string };
export type Goal = {
  id: string;
  title: string;
  milestones: { id: string; title: string; done: boolean }[];
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
  assistantAvatar: string;
  assistantConversation: DailyConversation | null;
  notes: string;
  pageWorkspaces: Record<string, PageWorkspace>;
  setPageWorkspace: (environmentId: string, workspace: PageWorkspace) => void;
  noteDrafts: Record<string, NoteDraft>;
  setNoteDraft: (environmentId: string, draft: NoteDraft) => void;
  goals: Goal[];
  goalWorkspaces: Record<string, GoalWorkspace>;
  legacyGoalsEnvironmentId: string | null;
  setGoalWorkspace: (environmentId: string, workspace: GoalWorkspace) => void;
  surface: WorkSurface;
  surfaceExpanded: boolean;
  studioView: StudioView | null;
  studioWidth: number;
  openStudio: (view: StudioView) => void;
  setStudioWidth: (width: number) => void;
  workExpanded: boolean;
  botsExpanded: boolean;
  inboxExpanded: boolean;
  setAssistantAvatar: (avatar: string) => void;
  rememberAssistant: (conversation: DailyConversation) => void;
  saveNotes: (notes: string) => void;
  saveGoals: (goals: Goal[]) => void;
  selectSurface: (surface: WorkSurface) => void;
  expandSurface: (expanded: boolean) => void;
  toggleWork: () => void;
  toggleBots: () => void;
  toggleInbox: () => void;
  expandNav: (section: "work" | "inbox") => void;
  reasoning: "low" | "medium" | "high" | "xhigh";
  setReasoning: (reasoning: "low" | "medium" | "high" | "xhigh") => void;
  timezone: string;
  plans: Record<string, DayPlan>;
  daily: Record<string, DailyConversation>;
  focus: Record<string, FocusMetadata>;
  companionPreference: boolean | null;
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
      chiefName: "Assistant",
      assistantAvatar: "🍊",
      assistantConversation: null,
      notes: "",
      pageWorkspaces: {},
      setPageWorkspace: (environmentId, workspace) =>
        set((state) => ({
          pageWorkspaces: { ...state.pageWorkspaces, [environmentId]: workspace },
        })),
      noteDrafts: {},
      setNoteDraft: (environmentId, draft) =>
        set((state) => ({ noteDrafts: { ...state.noteDrafts, [environmentId]: draft } })),
      goals: [],
      goalWorkspaces: {},
      legacyGoalsEnvironmentId: null,
      setGoalWorkspace: (environmentId, workspace) =>
        set((state) => ({
          goalWorkspaces: { ...state.goalWorkspaces, [environmentId]: workspace },
          legacyGoalsEnvironmentId: state.legacyGoalsEnvironmentId ?? environmentId,
        })),
      surface: "Notes",
      surfaceExpanded: false,
      studioView: null,
      studioWidth: 640,
      openStudio: (studioView) =>
        set({
          studioView,
          surface: studioView.area === "live" ? "Live Stream" : "Studio",
          utilityOpen: true,
          companionPreference: true,
        }),
      setStudioWidth: (studioWidth) =>
        set({ studioWidth: Number.isFinite(studioWidth) ? Math.max(280, studioWidth) : 640 }),
      workExpanded: true,
      botsExpanded: true,
      inboxExpanded: true,
      setAssistantAvatar: (avatar) => set({ assistantAvatar: avatar.trim().slice(0, 32) || "🍊" }),
      rememberAssistant: (assistantConversation) => set({ assistantConversation }),
      saveNotes: (notes) => set({ notes }),
      saveGoals: (goals) => set({ goals }),
      selectSurface: (surface) => set({ surface, utilityOpen: true, companionPreference: true }),
      expandSurface: (surfaceExpanded) => set({ surfaceExpanded }),
      toggleWork: () => set((state) => ({ workExpanded: !state.workExpanded })),
      toggleBots: () => set((state) => ({ botsExpanded: !state.botsExpanded })),
      toggleInbox: () => set((state) => ({ inboxExpanded: !state.inboxExpanded })),
      expandNav: (section) =>
        set(section === "work" ? { workExpanded: true } : { inboxExpanded: true }),
      reasoning: "xhigh",
      setReasoning: (reasoning) => set({ reasoning }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      plans: {},
      daily: {},
      focus: {},
      companionPreference: null,
      utilityOpen: false,
      utilityWidth: 320,
      configure: (chiefName, timezone) => {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions();
        set({ chiefName: chiefName.trim() || "Assistant", timezone });
      },
      savePlan: (day, plan) => set((state) => ({ plans: { ...state.plans, [day]: plan } })),
      rememberDaily: (day, conversation) =>
        set((state) => ({ daily: { ...state.daily, [day]: conversation } })),
      rememberFocus: (key, focus) => set((state) => ({ focus: { ...state.focus, [key]: focus } })),
      setUtilityOpen: (utilityOpen) => set({ utilityOpen, companionPreference: utilityOpen }),
      setUtilityWidth: (utilityWidth) =>
        set({ utilityWidth: Number.isFinite(utilityWidth) ? Math.max(280, utilityWidth) : 320 }),
    }),
    {
      name: "nima:workspace:v1",
      partialize: (state) => ({
        ...state,
        pageWorkspaces: pageRecoveryWorkspaces(state.pageWorkspaces),
      }),
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = persisted as Partial<NimaState>;
        const latestDay = Object.keys(saved?.daily ?? {})
          .sort()
          .at(-1);
        const latestPlan = Object.keys(saved?.plans ?? {})
          .sort()
          .at(-1);
        return {
          ...current,
          ...saved,
          surface:
            (saved?.surface as string) === "Design"
              ? "Studio"
              : (saved?.surface ?? current.surface),
          chiefName:
            saved?.chiefName === "Chief of Staff"
              ? "Assistant"
              : (saved?.chiefName ?? current.chiefName),
          assistantConversation:
            saved?.assistantConversation ?? (latestDay ? saved?.daily?.[latestDay] : null) ?? null,
          notes: saved?.notes ?? (latestPlan ? saved?.plans?.[latestPlan]?.notes : "") ?? "",
        };
      },
    },
  ),
);
