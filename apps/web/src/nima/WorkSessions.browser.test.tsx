import { ThreadId, BotId, HOME_BOT_ID, type BotProfile } from "@t3tools/contracts";
import { setAppearanceMode } from "~/hooks/useTheme";
import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
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
  await page.getByRole("button", { name: "Project teams", exact: true }).click();
  await page.getByRole("checkbox", { name: "Engineering Lead", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Engineering Lead project responsibility", exact: true })
    .fill("Verify checkout changes in this project.");
  await page.getByRole("button", { name: "Save team", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Save team", exact: true })).toBeEnabled();
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/project-team-dark.png" });
  await page.viewport(420, 860);
  await page.screenshot({ path: "/workspace/nima/.t3/project-team-narrow.png" });
  await page.viewport(1320, 900);
  setAppearanceMode("light");
  await page.screenshot({ path: "/workspace/nima/.t3/project-team-light.png" });
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
  await page.screenshot({ path: "/workspace/nima/.t3/work-session-light.png" });
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/work-session-dark.png" });
  await page.viewport(420, 860);
  await expect
    .element(page.getByRole("button", { name: "Session details", exact: true }))
    .toBeVisible();
  await page.screenshot({ path: "/workspace/nima/.t3/work-session-narrow.png" });
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
  await page.screenshot({ path: "/workspace/nima/.t3/work-project-session-dark.png" });
  setAppearanceMode("light");
});
