import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_BOT_CAPABILITIES,
  HOME_BOT_ID,
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectId,
  type ServerProvider,
  type BotProfile,
} from "@t3tools/contracts";
import { selectBotFallback } from "./botModelSelection.ts";

it("uses only configured, available fallbacks and keeps an available explicit model", () => {
  const primary = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };
  const fallback = { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet-5-5" };
  const provider = (id: string, patch: Partial<ServerProvider> = {}): ServerProvider => ({
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-06T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...patch,
  });
  const bot: BotProfile = {
    id: HOME_BOT_ID,
    home: true,
    threadId: null,
    archived: false,
    revision: 0,
    updatedAt: null,
    config: {
      name: "Citrus",
      avatar: "",
      description: "Personal assistant",
      instructions: "",
      timezone: "UTC",
      reasoning: "xhigh",
      modelSelection: primary,
      capabilities: { ...DEFAULT_BOT_CAPABILITIES, fallbackModels: [fallback] },
    },
  };
  const input = {
    selection: primary,
    bot,
    providers: [provider("codex"), provider("claude")],
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        claude: { driver: ProviderDriverKind.make("claudeAgent"), enabled: true, config: {} },
      },
    },
    projectId: ProjectId.make("project"),
    now: 0,
  };
  expect(selectBotFallback(input)).toEqual(primary);
  expect(
    selectBotFallback({
      ...input,
      providers: [provider("codex", { installed: false }), provider("claude")],
    }),
  ).toEqual(fallback);
  expect(
    selectBotFallback({
      ...input,
      providers: [
        provider("codex", { enabled: false }),
        provider("claude", { auth: { status: "unauthenticated" } }),
      ],
    }),
  ).toEqual(primary);
  expect(
    selectBotFallback({
      ...input,
      bot: null,
      providers: [provider("codex", { installed: false }), provider("claude")],
    }),
  ).toEqual(primary);
});
