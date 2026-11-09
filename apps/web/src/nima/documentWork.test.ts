import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { documentWorkAttachment } from "./documentWork";

it("keeps the full current Markdown and a correctly scoped source link in the attached snapshot", async () => {
  const markdown = "Unsaved café notes 📝\n\n" + "A paragraph.\n".repeat(12_000);
  const file = documentWorkAttachment(
    "https://bara.example/pair#private-token",
    EnvironmentId.make("host & one"),
    "page?two#three",
    {
      title: "../Notes / café",
      markdown,
      archived: false,
      source: null,
    },
  );
  expect(file.name).not.toContain("/");
  expect(file.name).toMatch(/\.md$/);
  expect(file.type).toBe("text/markdown");
  const text = await file.text();
  expect(text.endsWith(markdown)).toBe(true);
  const source = new URL(text.match(/\[Open in Library\]\(([^)]+)\)/)![1]!);
  expect(source.origin).toBe("https://bara.example");
  expect(source.pathname).toBe("/spaces");
  expect(source.searchParams.get("environmentId")).toBe("host & one");
  expect(source.searchParams.get("pageId")).toBe("page?two#three");
  expect(source.hash).toBe("");
  expect(text).not.toContain("private-token");
});

it("keeps Studio selections and saved revisions associated with their original host", async () => {
  const file = documentWorkAttachment(
    "https://bara.example/pair#private-token",
    EnvironmentId.make("creative-host"),
    "canvas-id",
    {
      title: "Poster",
      markdown: '{"selection":["headline"],"revision":7}',
      archived: false,
      source: null,
    },
    { area: "design", revision: 7, selection: ["headline"] },
  );
  const text = await file.text();
  const source = new URL(text.match(/\[Open in Studio\]\(([^)]+)\)/)![1]!);
  expect(source.pathname).toBe("/studio");
  expect(source.searchParams.get("environmentId")).toBe("creative-host");
  expect(source.searchParams.get("area")).toBe("design");
  expect(source.searchParams.get("id")).toBe("canvas-id");
  expect(text).toContain('"selection":["headline"]');
  expect(text).not.toContain("private-token");
});
