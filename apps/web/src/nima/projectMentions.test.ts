import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  formatComposerContextReference,
  projectComposerContextForProvider,
  projectContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { projectContextsForPrompt } from "./projectMentions";

it("keeps project references scoped to their machine and resolves only explicitly mentioned, available projects", () => {
  const zeus = {
    id: ProjectId.make("same-id"),
    environmentId: EnvironmentId.make("zeus"),
    title: "InflateMate",
    archivedAt: null,
  };
  const server = { ...zeus, environmentId: EnvironmentId.make("fresh-server") };
  const ref = projectContextRecord(
    { projectId: server.id, environmentId: server.environmentId },
    server.title,
  );
  const local = projectContextRecord(
    { projectId: zeus.id, environmentId: zeus.environmentId },
    zeus.title,
  );
  expect(ref.contextId).not.toBe(local.contextId);
  const prompt = `Review ${formatComposerContextReference(ref)}`;
  expect(projectContextsForPrompt(prompt, [zeus, server])).toEqual([ref]);
  expect(projectContextsForPrompt("Hello", [zeus, server])).toEqual([]);
  expect(
    projectContextsForPrompt(prompt, [zeus, { ...server, archivedAt: "2026-11-09T00:00:00Z" }]),
  ).toEqual([]);
  const renamed = projectContextsForPrompt(prompt, [zeus, { ...server, title: "InflateMate app" }]);
  expect(renamed[0]?.contextId).toBe(ref.contextId);
  const provider = projectComposerContextForProvider({ text: prompt, records: renamed });
  expect(provider).toContain("projectId: same-id");
  expect(provider).toContain("environmentId: fresh-server");
  expect(provider).toContain("title: InflateMate app");
  expect(provider).not.toContain("environmentId: zeus");
});
