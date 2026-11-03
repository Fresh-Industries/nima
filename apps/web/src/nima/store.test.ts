import { describe, expect, it, vi } from "vite-plus/test";
import { localDay, moveTask } from "./store";

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
      store.configure("Mira", "America/Chicago");
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
      expect(restored.timezone).toBe("America/Chicago");
      expect(restored.plans["2026-11-02"]).toEqual({
        notes: "Make room to think",
        tasks: [{ id: "a", text: "Edited priority", done: true }],
      });
      expect(restored.plans["2026-11-03"]).toEqual({ notes: "Next day", tasks: [] });
      expect(() => restored.configure("Name", "Invalid/Timezone")).toThrow();
      expect(restored.timezone).toBe("America/Chicago");
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
