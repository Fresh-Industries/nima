import { setAppearanceMode } from "~/hooks/useTheme";
import "~/index.css";
import { createMemoryHistory } from "@tanstack/react-router";
import type * as Context from "effect/Context";
import { HOME_BOT_ID, type BotProfile } from "@t3tools/contracts";
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

it("creates a project-free teammate, edits its configuration, and opens its separate conversation", async () => {
  await page.viewport(1320, 900);
  const thread = threadWithHistory("chef-conversation", 1);
  const assistant: BotProfile = {
    id: HOME_BOT_ID,
    home: true,
    threadId: null,
    revision: 1,
    archived: false,
    updatedAt: null,
    config: {
      name: "Citrus",
      avatar: "🍊",
      description: "Your everyday assistant",
      instructions: "",
      timezone: "UTC",
      reasoning: "xhigh",
      modelSelection: null,
    },
  };
  using _environment = installFakeEnvironment([thread], undefined, [assistant]);
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
  await router.navigate({ to: "/bots" });
  await expect
    .element(page.getByRole("heading", { name: "Citrus", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("link", { name: "Settings for Citrus", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(
      page.getByText("No bots yet", {
        exact: true,
      }),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Create a bot", exact: true }).click();
  await page.getByRole("button", { name: "Cooking", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Responsibility", exact: true })
    .fill("Help me cook vegetarian meals.");
  await page.getByRole("button", { name: "Create bot", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "Chef", exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/nima/.t3/bots-directory-light.png" });
  await page.getByRole("link", { name: "Settings for Chef" }).click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Use metric measurements.");
  await page
    .getByRole("combobox", { name: "Bara tool access", exact: true })
    .selectOptions("read-only");
  await page.getByText("Tool and resource rules", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Memory, Notes, Library and Goals", exact: true })
    .selectOptions("approval");
  await page.getByText("Execution safeguards", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Maximum run minutes", exact: true }).fill("12");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("Saved.");
  await page.getByRole("button", { name: "Open conversation", exact: true }).click();
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Bot settings", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Bot settings", exact: true }).click();
  await page.getByText("Advanced settings", { exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Instructions", exact: true }))
    .toHaveValue("Use metric measurements.");
  await expect
    .element(page.getByRole("combobox", { name: "Bara tool access", exact: true }))
    .toHaveValue("read-only");
  await page.getByText("Tool and resource rules", { exact: true }).click();
  await expect
    .element(page.getByRole("combobox", { name: "Memory, Notes, Library and Goals", exact: true }))
    .toHaveValue("approval");
  await page.getByText("Execution safeguards", { exact: true }).click();
  await expect
    .element(page.getByRole("spinbutton", { name: "Maximum run minutes", exact: true }))
    .toHaveValue(12);
  page
    .getByRole("combobox", { name: "Bara tool access", exact: true })
    .element()
    .scrollIntoView({ block: "center", behavior: "instant" });
  await page.screenshot({ path: "/workspace/nima/.t3/bots-settings.png" });
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/bot-tool-access-dark.png" });
  await page.viewport(420, 860);
  page
    .getByRole("combobox", { name: "Bara tool access", exact: true })
    .element()
    .scrollIntoView({ block: "center", behavior: "instant" });
  await page.screenshot({ path: "/workspace/nima/.t3/bot-tool-access-narrow.png" });
  await page.viewport(1320, 900);
  setAppearanceMode("light");
  await page.getByRole("link", { name: "Routines →", exact: true }).click();
  await expect
    .element(page.getByRole("heading", { name: "Chef · Routines", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Set up manually", exact: true }).click();
  await expect
    .element(page.getByRole("combobox", { name: "Bot", exact: true }))
    .toMatchTextContent(/Chef/);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("");
  await page
    .getByRole("textbox", { name: "Instructions", exact: true })
    .fill("Dinner ideas\nSuggest three vegetarian dinners using metric measurements.");
  await page.getByRole("button", { name: "Create routine", exact: true }).click();
  await expect
    .element(page.getByRole("heading", { name: "Dinner ideas", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect
    .element(page.getByRole("combobox", { name: "Bot", exact: true }))
    .toMatchTextContent(/Chef/);
  await expect
    .element(page.getByRole("textbox", { name: "Instructions", exact: true }))
    .toHaveValue("Dinner ideas\nSuggest three vegetarian dinners using metric measurements.");
  await page.getByText("Workspace & execution", { exact: true }).click();
  await expect
    .element(page.getByRole("combobox", { name: "Execution access", exact: true }))
    .toMatchTextContent(/Supervised/);
  await expect
    .element(page.getByRole("combobox", { name: "Project", exact: true }))
    .toMatchTextContent(/No project/);
  await page.getByText("Workspace & execution", { exact: true }).click();
  await page.getByText("Weekdays at 09:00 · UTC", { exact: true }).click();
  await page.getByRole("button", { name: "Once", exact: true }).click();
  await page.getByLabelText("Run on", { exact: true }).fill("");
  await page.getByText("Set schedule", { exact: true }).click();
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await expect.element(page.getByLabelText("Run on", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss notification", exact: true }).click();
  await page.getByRole("button", { name: "At a time", exact: true }).click();
  await page.getByLabelText("Run at", { exact: true }).fill("18:00");
  await page.getByRole("button", { name: "Save routine", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(page.getByText("Weekdays at 18:00 · UTC", { exact: true })).toBeVisible();
  setAppearanceMode("dark");
  await page.screenshot({ path: "/workspace/nima/.t3/bot-routine-editor-dark.png" });
  await page.viewport(420, 860);
  await page.screenshot({ path: "/workspace/nima/.t3/bot-routine-editor-narrow.png" });
  await page.viewport(1320, 900);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: "/workspace/nima/.t3/bot-routine-detail-dark.png" });
  setAppearanceMode("light");
  await page.screenshot({ path: "/workspace/nima/.t3/bot-routine-detail-light.png" });

  await router.navigate({ to: "/bots" });
  setAppearanceMode("dark");
  await expect.element(page.getByRole("heading", { name: "Chef", exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/nima/.t3/bots-directory-dark.png" });
  await page.viewport(420, 860);
  await expect.element(page.getByRole("heading", { name: "Chef", exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/nima/.t3/bots-directory-narrow.png" });
  setAppearanceMode("light");
});
