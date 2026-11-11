import { ThreadId, BotId, HOME_BOT_ID, type BotProfile } from "@t3tools/contracts";
import { setAppearanceMode } from "~/hooks/useTheme";
import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import "~/nima/Bots";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
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

it("creates personal Work with an existing Bot, keeps the objective in its own composer, and changes its coordinator", async () => {
  await page.viewport(1320, 900);
  const assistant = { ...threadWithHistory("home-chat", 1), settled: true };
  const config = {
    name: "Citrus",
    avatar: "🍊",
    description: "Everyday assistant",
    instructions: "",
    timezone: "UTC",
    reasoning: "xhigh" as const,
    modelSelection: null,
  };
  const home: BotProfile = {
    id: HOME_BOT_ID,
    home: true,
    config,
    threadId: assistant.id,
    revision: 1,
    archived: false,
    updatedAt: null,
  };
  const lead: BotProfile = {
    ...home,
    id: BotId.make("lead"),
    home: false,
    config: {
      ...config,
      name: "Engineering Lead",
      avatar: "",
      description: "Coordinate engineering",
    },
    threadId: null,
  };
  using _environment = installFakeEnvironment(
    [assistant],
    {
      metadata: [
        {
          threadId: assistant.id,
          kind: "assistant",
          title: "",
          objective: "",
          state: null,
          version: null,
          latestRunIsBot: false,
        },
      ],
      items: [],
      pendingCount: 0,
      nextCursor: null,
    },
    [home, lead],
  );
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${assistant.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await expect.element(page.getByText(/^Settled .*ago/)).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Un-settle", exact: true }))
    .not.toBeInTheDocument();
  await router.navigate({ to: "/work", search: { environmentId: ENVIRONMENT_ID, botId: lead.id } });
  const dock = page.getByRole("navigation", { name: "Tools", exact: true });
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(dock).toHaveAttribute("data-revealed");
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(dock).not.toHaveAttribute("data-revealed");
  await page.getByRole("button", { name: "Chat with Citrus", exact: true }).click();
  const floating = page.getByRole("region", { name: "Citrus, your Assistant", exact: true });
  const assistantComposer = floating.getByTestId("composer-editor");
  await assistantComposer.fill("Plan my week without starting work yet.");
  const composerElement = assistantComposer.element();
  await router.navigate({ to: "/inbox" });
  await expect.element(assistantComposer).toMatchTextContent(/Plan my week/);
  expect(assistantComposer.element()).toBe(composerElement);
  await page.viewport(700, 560);
  await vi.waitFor(() => {
    const bounds = floating.element().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(8);
    expect(bounds.right).toBeLessThanOrEqual(692);
    expect(bounds.top).toBeGreaterThanOrEqual(52);
    expect(bounds.bottom).toBeLessThanOrEqual(552);
    expect(bounds.width).toBe(420);
  });
  await floating.getByRole("button", { name: "Minimize", exact: true }).click();
  await page.getByRole("button", { name: "Chat with Citrus", exact: true }).click();
  await expect.element(assistantComposer).toMatchTextContent(/Plan my week/);
  await floating.getByRole("button", { name: "Open full screen", exact: true }).click();
  await expect.element(page.getByTestId("composer-editor")).toMatchTextContent(/Plan my week/);
  await page.viewport(1320, 900);
  await router.navigate({ to: "/work", search: { environmentId: ENVIRONMENT_ID, botId: lead.id } });
  await page.getByRole("button", { name: "Project teams", exact: true }).click();
  await page.getByRole("checkbox", { name: "Engineering Lead", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Engineering Lead project responsibility", exact: true })
    .fill("Verify checkout changes in this project.");
  await page.getByRole("button", { name: "Save team", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Save team", exact: true })).toBeEnabled();
  setAppearanceMode("dark");
  await page.screenshot({ path: "./.t3/project-team-dark.png" });
  await page.viewport(420, 860);
  await page.screenshot({ path: "./.t3/project-team-narrow.png" });
  await page.viewport(1320, 900);
  setAppearanceMode("light");
  await page.screenshot({ path: "./.t3/project-team-light.png" });
  await page.getByText("Close", { exact: true }).click();
  await page.getByRole("button", { name: "Project teams", exact: true }).click();
  await expect
    .element(
      page.getByRole("textbox", { name: "Engineering Lead project responsibility", exact: true }),
    )
    .toHaveValue("Verify checkout changes in this project.");
  await page.getByText("Close", { exact: true }).click();
  await page.getByRole("button", { name: "Focus session", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Learn photography");
  await page
    .getByRole("textbox", { name: "Objective", exact: true })
    .fill("Make a simple seven-day practice plan.");
  await page.getByRole("button", { name: "Open focus session", exact: true }).click();
  await expect
    .element(page.getByTestId("composer-editor"))
    .toMatchTextContent(/Make a simple seven-day practice plan/);
  await expect
    .element(page.getByRole("button", { name: "Session details", exact: true }))
    .toBeVisible();
  const workThreadId = ThreadId.make(router.state.location.pathname.split("/").at(-1)!);
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId: assistant.id },
  });
  await expect
    .element(page.getByTestId("composer-editor"))
    .not.toMatchTextContent(/Make a simple seven-day practice plan/);
  await router.navigate({
    to: "/$environmentId/$threadId",
    params: { environmentId: ENVIRONMENT_ID, threadId: workThreadId },
  });
  await expect
    .element(page.getByTestId("composer-editor"))
    .toMatchTextContent(/Make a simple seven-day practice plan/);
  await page.getByRole("button", { name: "Session details", exact: true }).click();
  await expect
    .element(page.getByRole("combobox", { name: "Coordinator", exact: true }))
    .toHaveValue(lead.id);
  await expect.element(page.getByRole("dialog")).toMatchTextContent(/Personal/);
  const select = page.getByRole("combobox", { name: "Coordinator", exact: true });
  await select.selectOptions("");
  await page.getByRole("button", { name: "Save coordinator", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByText("Unassigned", { exact: true })).toBeVisible();
  await page.screenshot({ path: "./.t3/work-session-light.png" });
  setAppearanceMode("dark");
  await page.screenshot({ path: "./.t3/work-session-dark.png" });
  await page.viewport(420, 860);
  await expect
    .element(page.getByRole("button", { name: "Session details", exact: true }))
    .toBeVisible();
  await page.screenshot({ path: "./.t3/work-session-narrow.png" });
  await page.viewport(1320, 900);
  await router.navigate({ to: "/work", search: { environmentId: ENVIRONMENT_ID, botId: lead.id } });
  await page.getByRole("button", { name: "Focus session", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Checkout fix");
  await page.getByRole("textbox", { name: "Objective", exact: true }).fill("Diagnose checkout.");
  await page.getByText("Project & environment", { exact: true }).click();
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOptions(PROJECT_ID);
  await page.getByRole("button", { name: "Open focus session", exact: true }).click();
  await expect.element(page.getByTestId("composer-editor")).toMatchTextContent(/Diagnose checkout/);
  await page.getByRole("button", { name: "Session details", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toMatchTextContent(/Personal/);
  await expect
    .element(page.getByRole("combobox", { name: "Coordinator", exact: true }))
    .toHaveValue(lead.id);
  await page.getByText("Close", { exact: true }).click();
  await page.screenshot({ path: "./.t3/work-project-session-dark.png" });
  setAppearanceMode("light");
  await router.navigate({
    to: "/work",
    search: { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID },
  });
  await userEvent.keyboard("{Control>}b{/Control}");
  await dock.getByRole("button", { name: "Customize tools", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Your dock", exact: true });
  const pinSettings = picker.getByRole("button", { name: "Settings", exact: true });
  await pinSettings.click();
  await expect.element(pinSettings).toHaveAttribute("aria-pressed", "true");
  await expect.element(dock.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await pinSettings.click();
  await expect.element(pinSettings).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: "./.t3/workspace-dock-light.png" });
  setAppearanceMode("dark");
  await page.screenshot({ path: "./.t3/workspace-dock-dark.png" });
  setAppearanceMode("light");
  await userEvent.keyboard("{Escape}");
  await expect.element(picker).not.toBeInTheDocument();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Checkout fix" })
    .getByRole("button", { name: "Send to Inbox", exact: true })
    .click();
  await expect.poll(() => router.state.location.pathname).toBe("/inbox");
  await expect.element(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("article").getByText("Checkout fix", { exact: true }))
    .toBeVisible();
  await page.screenshot({ path: "./.t3/work-inbox-handoff.png" });
});
