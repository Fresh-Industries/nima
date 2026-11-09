import { expect, it } from "vite-plus/test";
import { inboxSummary } from "./inboxSummary";

it("keeps a long photography deliverable to its introductory overview", () => {
  const overview =
    "You only need a phone or any camera you already have. Each session takes 25 minutes.";
  const result = `${overview}\n\n## Day 1: Get comfortable\n\n**Goal:** Take photos deliberately.\n\n${"Detailed instructions. ".repeat(100)}`;
  expect(inboxSummary(result)).toBe(overview);
  expect(inboxSummary(result)).not.toContain("Day 1");
});

it("removes Markdown syntax and link targets while keeping the visible meaning", () => {
  expect(
    inboxSummary(
      "## Summary\n\nUpdated **the plan** and saved [your guide](https://example.test/guide). Ready for review.\n\n## Details\n\nLong body.",
    ),
  ).toBe("Updated the plan and saved your guide. Ready for review.");
  expect(
    inboxSummary(
      "## Result\n\n```sh\nprivate-command\n```\n\nThe export failed because FFmpeg was unavailable. Install the encoder before retrying.",
    ),
  ).toBe("The export failed because FFmpeg was unavailable. Install the encoder before retrying.");
});

it("bounds long prose without changing or erasing the full result", () => {
  const original = "An unusually long overview " + "with many useful details ".repeat(50);
  const summary = inboxSummary(original);
  expect(summary.length).toBeLessThanOrEqual(300);
  expect(summary.endsWith("…")).toBe(true);
  expect(original.length).toBeGreaterThan(1000);
  expect(inboxSummary("")).toBe("");
});
