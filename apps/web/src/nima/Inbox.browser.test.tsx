import { createMemoryHistory } from "@tanstack/react-router";
import "~/index.css";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import { setAppearanceMode } from "~/hooks/useTheme";
import "~/components/ChatView";
import "~/nima/Inbox";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

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

it("shows a compact Inbox overview and opens the complete result in its conversation", async () => {
  await page.viewport(1320, 900);
  const thread = threadWithHistory("inbox-photography", 1);
  const overview = "You only need a phone or camera. Each session takes 25 minutes.";
  const detail = "Day 1: Get comfortable with your camera";
  const result = `${overview}\n\n## ${detail}\n\nTake three photos of an everyday object.`;
  const items = thread.items.map((item) =>
    item.type === "assistant_message" ? { ...item, text: result } : item,
  );
  using _environment = installFakeEnvironment(
    [{ ...thread, items }],
    {
      metadata: [],
      pendingCount: 1,
      nextCursor: null,
      items: [
        {
          key: `focus:${thread.id}`,
          version: thread.runs[0]!.id,
          kind: "focus",
          threadId: thread.id,
          runId: thread.runs[0]!.id,
          botId: null,
          title: "Photography plan",
          summary: result,
          completedAt: "2026-11-04T12:00:00.000Z",
          status: "completed",
          state: "review",
        },
      ],
    },
    [],
    [],
    [
      {
        id: "approval-1",
        threadId: thread.id,
        botNames: ["Chef"],
        tool: "t3_notes_write",
        arguments: '{"title":"Dinner plan"}',
        status: "pending",
        revision: 0,
        createdAt: "2026-11-04T12:00:00.000Z",
        expiresAt: "2099-11-05T12:00:00.000Z",
      },
    ],
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await router.navigate({ to: "/inbox" });
  await expect.element(page.getByText(overview, { exact: true })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: detail })).not.toBeInTheDocument();
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/inbox-review-dark.png" });
  await page.getByText("Review exact arguments", { exact: true }).click();
  await expect.element(page.getByText('{"title":"Dinner plan"}', { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve one retry", exact: true }).click();
  await expect.element(page.getByText("Approved for one retry.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Revoke approval", exact: true }).click();
  await page.getByRole("button", { name: "Settled", exact: true }).click();
  await page.getByRole("button", { name: "Reopen review", exact: true }).click();
  await page.getByRole("button", { name: /Waiting/ }).click();
  await expect
    .element(page.getByRole("button", { name: "Approve one retry", exact: true }))
    .toBeVisible();
  await page.getByRole("link", { name: "Read full result & reply →" }).click();
  await expect.element(page.getByRole("heading", { name: detail })).toBeVisible();
});
