import {
  isProviderAvailable,
  resolveProjectProviderInstanceEnabled,
  type BotProfile,
  type ProjectId,
  type ServerSettings,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import type { ModelSelection } from "@t3tools/contracts";

export function selectBotFallback(input: {
  selection: ModelSelection;
  bot: BotProfile | null;
  providers: ReadonlyArray<ServerProvider>;
  settings: ServerSettings;
  projectId: ProjectId;
  now: number;
}): ModelSelection {
  const usable = (selection: ModelSelection) =>
    input.providers.some(
      (provider) =>
        provider.instanceId === selection.instanceId &&
        provider.enabled &&
        provider.installed &&
        provider.auth.status !== "unauthenticated" &&
        isProviderAvailable(provider) &&
        resolveProjectProviderInstanceEnabled(
          input.settings,
          input.projectId,
          provider.instanceId,
        ) &&
        !exhaustedUsageWindow(provider, input.now, selection.model),
    );
  if (usable(input.selection)) return input.selection;
  return input.bot?.config.capabilities?.fallbackModels.find(usable) ?? input.selection;
}

export function selectBotModel(input: {
  bot: BotProfile | null;
  projectId: ProjectId;
  defaults: Pick<ServerSettings, "defaultModelSelection" | "fallbackModelSelection">;
  providers: ReadonlyArray<ServerProvider>;
  settings: ServerSettings;
  now: number;
}) {
  const { bot, providers, settings, projectId, defaults } = input;
  const availableProviders = providers.filter(
    (provider) =>
      provider.enabled &&
      isProviderAvailable(provider) &&
      resolveProjectProviderInstanceEnabled(settings, projectId, provider.instanceId) &&
      provider.models.length,
  );
  const preferred = bot?.home
    ? availableProviders.find(
        (provider) =>
          provider.driver === "codex" &&
          provider.models.some((model) => model.slug === "gpt-6.1-sol"),
      )
    : undefined;
  const available = preferred ?? availableProviders[0];
  const model = available?.models.find((model) => model.isDefault) ?? available?.models[0];
  const resolved = resolveNewThreadModelSelection({
    defaultSelection:
      bot?.config.modelSelection ??
      (preferred
        ? {
            instanceId: preferred.instanceId,
            model: "gpt-6.1-sol",
            options: [{ id: "reasoningEffort", value: "xhigh" }],
          }
        : defaults.defaultModelSelection) ??
      (available && model ? { instanceId: available.instanceId, model: model.slug } : null),
    fallbackSelection: defaults.fallbackModelSelection,
    providers,
    settings,
    projectId,
    now: input.now,
  }).selection;
  return resolved === null
    ? null
    : selectBotFallback({
        selection: resolved,
        bot,
        providers,
        settings,
        projectId,
        now: input.now,
      });
}
