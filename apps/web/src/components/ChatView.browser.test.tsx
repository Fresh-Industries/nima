import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  ThreadId,
  NodeId,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  TurnItemId,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import "~/nima/Inbox";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  emitThreadEvent,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";
import { useNimaStore } from "~/nima/store";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("a new draft does not load its reserved thread before the server lists it", async () => {
  await page.viewport(1320, 900);
  using _environment = installFakeEnvironment([]);
  using fetchSpy = vi.spyOn(globalThis, "fetch");
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const draftId = DraftId.make("draft-27443");
  const threadId = ThreadId.make("thread-27443");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });

  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  // The shell snapshot has arrived once the sidebar lists the project, so the connection is up.
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();

  const threadRequests = fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes(`/api/orchestration/threads/${threadId}/`));
  // A 404 here marks the thread deleted, and the view never loads it once the send creates it.
  expect(threadRequests).toEqual([]);
});

it.each(["local", "remote"] as const)(
  "follows a %s delegated Work session through real thread updates without blocking the assistant composer",
  async (location) => {
    await page.viewport(1320, 900);
    const parent = threadWithHistory(`assistant-work-${location}`, 3);
    const wakeRun = parent.runs[1]!;
    const hiddenDeliverable =
      "DETAILED FOCUS RESULT: the entire learning plan belongs in the work conversation.";
    const ordinaryReply =
      "This is a normal assistant reply, with details you explicitly requested.";
    const parentRuns = parent.runs.map((run, index) =>
      index === 0
        ? {
            ...run,
            delegatedCompletion: {
              disposition: "open" as const,
              nextGeneration: 2,
              delivery: null,
            },
          }
        : run,
    );
    const parentItems = parent.items.map((item) =>
      item.type !== "assistant_message"
        ? item
        : {
            ...item,
            text: item.runId === wakeRun.id ? hiddenDeliverable : ordinaryReply,
          },
    );
    const child = threadWithHistory(`research-work-${location}`, 0);
    const targetHost =
      location === "remote" ? EnvironmentId.make("linked-research-host") : ENVIRONMENT_ID;
    const at = DateTime.makeUnsafe("2026-11-04T12:00:00.000Z");
    const task: OrchestrationV2Subagent = {
      id: NodeId.make(`task-work-${location}`),
      threadId: parent.id,
      runId: parent.runs[0]!.id,
      parentNodeId: NodeId.make("parent-root"),
      origin: "app_owned",
      createdBy: "agent",
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerThreadId: null,
      childThreadId: location === "local" ? child.id : null,
      ...(location === "remote"
        ? {
            remoteChild: {
              environmentId: targetHost,
              threadId: child.id,
              label: "Linked research host",
            },
          }
        : {}),
      nativeTaskRef: null,
      prompt: "Compare three note syncing approaches",
      title: "Sync research",
      model: "gpt-5.4",
      status: "running",
      result: null,
      startedAt: at,
      completedAt: null,
      updatedAt: at,
    };
    const item: OrchestrationV2TurnItem = {
      id: TurnItemId.make(`work-card-${location}`),
      threadId: parent.id,
      runId: parent.runs[0]!.id,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 2,
      status: "running",
      title: task.title,
      startedAt: at,
      completedAt: null,
      updatedAt: at,
      type: "subagent",
      subagentId: task.id,
      origin: task.origin,
      driver: task.driver,
      providerInstanceId: task.providerInstanceId,
      childThreadId: task.childThreadId,
      ...(task.remoteChild ? { remoteChild: task.remoteChild } : {}),
      prompt: task.prompt,
      result: null,
    };
    using _environment = installFakeEnvironment([
      {
        ...parent,
        runs: parentRuns,
        subagents: [task],
        items: [
          ...parentItems,
          item,
          {
            ...item,
            id: TurnItemId.make(`work-notification-${location}`),
            runId: wakeRun.id,
            type: "notification",
            ordinal: 3,
            status: "completed",
            source: { kind: "delegated_task", taskIds: [task.id] },
            outcome: "completed",
            summary: "Use a local log with conflict-aware sync.",
          },
        ],
        messages: [
          {
            id: wakeRun.userMessageId,
            threadId: parent.id,
            runId: wakeRun.id,
            nodeId: null,
            role: "user",
            createdBy: "system",
            creationSource: "server",
            text: "Automatic completion delivery",
            attachments: [],
            streaming: false,
            createdAt: at,
            updatedAt: at,
            delegatedCompletion: {
              parentRunId: parent.runs[0]!.id,
              generation: 1,
              taskIds: [task.id],
            },
          },
        ],
      },
      { ...child, title: "Sync research" },
    ]);
    useNimaStore.getState().rememberAssistant({
      environmentId: ENVIRONMENT_ID,
      threadId: parent.id,
      draftId: DraftId.make(`draft-work-${location}`),
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${parent.id}`] }),
    );
    await router.load();
    await using _app = await render(<AppRoot router={router} />, {
      // AppRoot owns the router for this integrated thread-stream scenario.
      router: false,
    });
    const card = page.getByRole("region", { name: "Work session: Sync research" });
    await expect.element(card).toBeVisible();
    await expect.element(card.getByText("Working", { exact: true })).toBeVisible();
    await page.screenshot({ path: `/workspace/nima/.t3/single-focus-layout-${location}.png` });

    await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    await expect
      .element(page.getByRole("region", { name: "Focus Session update" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText(hiddenDeliverable, { exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByText(ordinaryReply, { exact: true }).last()).toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Open conversation", exact: true }))
      .toHaveAttribute("href", `/${targetHost}/${child.id}`);
    await emitThreadEvent(parent.id, {
      type: "subagent.updated",
      payload: {
        ...task,
        status: "completed",
        result: "Use a local log with conflict-aware sync.",
        completedAt: at,
      },
    });
    await expect.element(card.getByText("Ready to review", { exact: true })).toBeVisible();
    await expect
      .element(card.getByText("Use a local log with conflict-aware sync.", { exact: true }))
      .toBeVisible();
    await expect
      .element(card.getByRole("link", { name: "Open result", exact: true }))
      .toHaveAttribute("href", `/${targetHost}/${child.id}`);
    await page.screenshot({ path: `/workspace/nima/.t3/single-focus-result-${location}.png` });
    await emitThreadEvent(parent.id, {
      type: "subagent.updated",
      payload: { ...task, status: "running", result: null, progress: "Checking the follow-up" },
    });
    await expect.element(card.getByText("Working", { exact: true })).toBeVisible();
    await expect
      .element(card.getByText("Ready to review", { exact: true }))
      .not.toBeInTheDocument();
  },
);
