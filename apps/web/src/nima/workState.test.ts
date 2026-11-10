import { expect, it } from "vite-plus/test";
import { threadWorkState } from "./workState";

type Thread = Parameters<typeof threadWorkState>[0];

const idle: Thread = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  pendingSubagentRequest: null,
  runtime: null,
  latestRun: null,
  pendingBackgroundTasks: [],
};
const runtime = (status: "running" | "queued") =>
  ({
    status,
    activeRunId: null,
    providerInstanceId: "codex",
    providerName: null,
    lastError: null,
  }) as NonNullable<Thread["runtime"]>;
const run = (status: "completed" | "failed" | "interrupted") =>
  ({
    status,
    runId: "run",
    requestedAt: null,
    startedAt: null,
    completedAt: null,
    assistantMessageId: null,
  }) as NonNullable<Thread["latestRun"]>;

it.each([
  [
    "a child agent's question",
    { pendingSubagentRequest: "user_input" as const, runtime: runtime("running") },
    "needs-you",
  ],
  ["a pending approval", { hasPendingApprovals: true }, "needs-you"],
  ["an actionable plan", { hasActionableProposedPlan: true }, "needs-you"],
  ["a queued run", { runtime: runtime("queued") }, "queued"],
  ["an active runtime", { runtime: runtime("running") }, "working"],
  ["a failed run", { latestRun: run("failed") }, "stopped"],
  ["an interrupted run", { latestRun: run("interrupted") }, "stopped"],
  ["a completed run", { latestRun: run("completed") }, "ready"],
])("derives the work state for %s", (_name, patch, expected) => {
  expect(threadWorkState({ ...idle, ...patch })).toBe(expected);
});

it("treats Bara-tracked background work as working", () => {
  expect(threadWorkState({ ...idle, latestRun: run("completed") }, true)).toBe("working");
});
