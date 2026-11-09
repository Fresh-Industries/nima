import type { EnvironmentId, StudioArea, WorkspacePageContent } from "@t3tools/contracts";

export type StudioWorkSource = { area: StudioArea; revision: number; selection: readonly string[] };

export function documentWorkAttachment(
  origin: string,
  environmentId: EnvironmentId,
  pageId: string,
  content: WorkspacePageContent,
  studio?: StudioWorkSource,
) {
  const source = new URL(studio ? "/studio" : "/spaces", origin);
  source.searchParams.set("environmentId", environmentId);
  source.searchParams.set(studio ? "id" : "pageId", pageId);
  if (studio) source.searchParams.set("area", studio.area);
  const title = content.title.trim() || "Untitled";
  const name = title.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 80);
  return new File(
    [
      `# ${title}\n\n[Open in ${studio ? "Studio" : "Library"}](${source.href})\n\n---\n\n`,
      content.markdown,
    ],
    `${name}.md`,
    { type: "text/markdown" },
  );
}
