import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  collectComposerContextReferences,
  projectContextRecord,
} from "@t3tools/shared/composerContextReferences";

export function projectContextsForPrompt(
  prompt: string,
  projects: ReadonlyArray<
    Pick<EnvironmentProject, "id" | "environmentId" | "title" | "archivedAt">
  >,
) {
  const references = new Set(
    collectComposerContextReferences(prompt)
      .filter((entry) => entry.kind === "project")
      .map((entry) => entry.contextId),
  );
  if (!references.size) return [];
  return projects
    .filter((project) => project.archivedAt == null)
    .map((project) =>
      projectContextRecord(
        { environmentId: project.environmentId, projectId: project.id },
        project.title,
      ),
    )
    .filter((record) => references.has(record.contextId));
}
