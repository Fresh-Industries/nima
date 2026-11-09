import { describe, expect, it, vi } from "vite-plus/test";
import { localDay, moveTask } from "./store";
import { EnvironmentId } from "@t3tools/contracts";

describe("Nima daily planning", () => {
  it("rolls over by the configured timezone across midnight and daylight saving", () => {
    expect(localDay(new Date("2026-11-03T05:59:59Z"), "America/Chicago")).toBe("2026-11-02");
    expect(localDay(new Date("2026-11-03T06:00:00Z"), "America/Chicago")).toBe("2026-11-03");
    expect(localDay(new Date("2026-03-08T07:59:59Z"), "America/Chicago")).toBe("2026-03-08");
    expect(localDay(new Date("2026-03-08T08:00:00Z"), "America/Chicago")).toBe("2026-03-08");
    expect(localDay(new Date("2026-11-03T01:00:00Z"), "Asia/Tokyo")).toBe("2026-11-03");
  });

  it("reorders without mutating the saved tasks and leaves boundary moves intact", () => {
    const tasks = [
      { id: "a", text: "First", done: false },
      { id: "b", text: "Second", done: true },
      { id: "c", text: "Third", done: false },
    ];
    expect(moveTask(tasks, "b", -1).map((task) => task.id)).toEqual(["b", "a", "c"]);
    expect(moveTask(tasks, "b", 1).map((task) => task.id)).toEqual(["a", "c", "b"]);
    expect(tasks.map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(moveTask(tasks, "a", -1)).toBe(tasks);
    expect(moveTask(tasks, "c", 1)).toBe(tasks);
    expect(moveTask(tasks, "missing", 1)).toBe(tasks);
  });

  it("restores edited plans and preferences from durable browser storage", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.resetModules();
    try {
      const { useNimaStore } = await import("./store");
      const store = useNimaStore.getState();
      expect(store.reasoning).toBe("xhigh");
      expect(store.utilityOpen).toBe(false);
      expect(store.companionPreference).toBeNull();
      store.configure("Mira", "America/Chicago");
      store.setReasoning("high");
      store.setAssistantAvatar("🌿");
      store.saveNotes("A persistent workspace note");
      const { newPageDraft } = await import("./pages");
      store.setPageWorkspace("pages-server", { drafts: { offline: newPageDraft() } });

      store.setNoteDraft("notes-server", {
        markdown: "# Offline edit",
        baseMarkdown: "# Saved",
        baseRevision: 3,
        pendingMarkdown: "# Lost reply",
      });
      store.saveGoals([
        {
          id: "goal-one",
          title: "Launch Bara",
          milestones: [{ id: "step-one", title: "Polish the shell", done: true }],
        },
      ]);
      store.openStudio({
        environmentId: EnvironmentId.make("studio-host"),
        area: "photo",
        id: "photo-one",
      });
      store.setStudioWidth(760);
      store.setUtilityWidth(9999);
      store.savePlan("2026-11-02", {
        notes: "Make room to think",
        tasks: [{ id: "a", text: "Edited priority", done: true }],
      });
      store.savePlan("2026-11-03", { notes: "Next day", tasks: [] });
      const persisted = values.get("nima:workspace:v1");
      expect(persisted).toBeDefined();
      vi.resetModules();
      const restored = (await import("./store")).useNimaStore.getState();
      expect(restored.chiefName).toBe("Mira");
      expect(restored.reasoning).toBe("high");
      expect(restored.assistantAvatar).toBe("🌿");
      expect(restored.notes).toBe("A persistent workspace note");
      expect(restored.pageWorkspaces["pages-server"]?.drafts.offline?.content.title).toBe(
        "Untitled",
      );
      expect(restored.noteDrafts["notes-server"]).toEqual({
        markdown: "# Offline edit",
        baseMarkdown: "# Saved",
        baseRevision: 3,
        pendingMarkdown: "# Lost reply",
      });
      expect(restored.goals[0]?.milestones[0]?.done).toBe(true);
      expect(restored.surface).toBe("Studio");
      expect(restored.studioView).toEqual({
        environmentId: "studio-host",
        area: "photo",
        id: "photo-one",
      });
      expect(restored.studioWidth).toBe(760);
      expect(restored.companionPreference).toBe(true);
      restored.setUtilityOpen(false);
      const closed = (await import("./store")).useNimaStore.getState();
      expect(closed.surface).toBe("Studio");
      expect(closed.companionPreference).toBe(false);
      expect(restored.utilityWidth).toBe(9999);
      expect(restored.timezone).toBe("America/Chicago");
      expect(restored.plans["2026-11-02"]).toEqual({
        notes: "Make room to think",
        tasks: [{ id: "a", text: "Edited priority", done: true }],
      });
      expect(restored.plans["2026-11-03"]).toEqual({ notes: "Next day", tasks: [] });
      expect(() => restored.configure("Name", "Invalid/Timezone")).toThrow();
      expect(restored.timezone).toBe("America/Chicago");
      values.set(
        "nima:workspace:v1",
        JSON.stringify({
          state: {
            chiefName: "Chief of Staff",
            surface: "Design",
            timezone: "America/Chicago",
            plans: { "2026-11-02": { notes: "Legacy notes", tasks: [] } },
            daily: {
              "2026-11-02": {
                environmentId: "env-one",
                threadId: "thread-one",
                draftId: "draft-one",
              },
            },
          },
          version: 0,
        }),
      );
      vi.resetModules();
      const migrated = (await import("./store")).useNimaStore.getState();
      expect(migrated.chiefName).toBe("Assistant");
      expect(migrated.surface).toBe("Studio");
      expect(migrated.studioWidth).toBe(640);
      expect(migrated.assistantConversation?.threadId).toBe("thread-one");
      expect(migrated.notes).toBe("Legacy notes");
      expect(migrated.plans["2026-11-02"]?.notes).toBe("Legacy notes");
      expect(migrated.goals).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
