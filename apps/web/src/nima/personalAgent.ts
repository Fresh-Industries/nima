import type { ModelCapabilities, ProviderOptionSelection } from "@t3tools/contracts";
import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";

export type PersonalReasoning = "low" | "medium" | "high" | "xhigh";

export function personalReasoningOptions(
  capabilities: ModelCapabilities,
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  reasoning: PersonalReasoning,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const descriptor = capabilities.optionDescriptors?.find(isReasoningSelect);
  const choice = descriptor?.options.find((option) => option.id === reasoning);
  if (!descriptor || !choice) return options ?? undefined;
  return [
    ...(options ?? []).filter((option) => option.id !== descriptor.id),
    { id: descriptor.id, value: choice.id },
  ];
}
