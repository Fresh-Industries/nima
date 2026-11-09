import { expect, it } from "vite-plus/test";
import { dailyTimeline, timelineDayLabels } from "./dailyHistory";

it("folds older assistant days at local midnight and reveals a whole previous day without dropping newer messages", () => {
  const entries = [
    { id: "older", createdAt: "2026-11-08T04:00:00Z" },
    { id: "yesterday-one", createdAt: "2026-11-08T18:00:00Z" },
    { id: "yesterday-two", createdAt: "2026-11-09T05:59:59Z" },
    { id: "today", createdAt: "2026-11-09T06:00:00Z" },
  ];
  const today = dailyTimeline(entries, "2026-11-09", "America/Chicago");
  expect(today.entries.map((entry) => entry.id)).toEqual(["today"]);
  expect(today.previous).toBe("2026-11-08");
  const previous = dailyTimeline(entries, today.previous!, "America/Chicago");
  expect(previous.entries.map((entry) => entry.id)).toEqual([
    "yesterday-one",
    "yesterday-two",
    "today",
  ]);
  expect(previous.previous).toBe("2026-11-07");
  expect(entries).toHaveLength(4);
  expect(
    dailyTimeline(entries, "2026-11-09", "Asia/Tokyo").entries.map((entry) => entry.id),
  ).toEqual(["yesterday-one", "yesterday-two", "today"]);
});

it("labels each revealed day once and keeps Today at its original message boundary", () => {
  const rows = [
    { id: "yesterday-a", createdAt: "2026-11-09T00:00:00Z" },
    { id: "yesterday-b", createdAt: "2026-11-09T05:59:59Z" },
    { id: "today-a", createdAt: "2026-11-09T06:00:00Z" },
    { id: "today-b", createdAt: "2026-11-09T12:00:00Z" },
  ];
  const labels = timelineDayLabels(rows, "America/Chicago", "2026-11-09");
  expect([...labels.keys()]).toEqual(["yesterday-a", "today-a"]);
  expect(labels.get("today-a")).toBe("Today");
  expect(labels.get("yesterday-a")).toContain("8");
});
