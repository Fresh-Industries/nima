import { describe, expect, it } from "vite-plus/test";
import type { ModelCapabilities } from "@t3tools/contracts";
import { personalReasoningOptions } from "./personalAgent";

const capabilities: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "thinking_budget",
      label: "Thinking",
      role: "reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    },
  ],
};

describe("Personal agent reasoning", () => {
  it("uses the provider's reasoning descriptor and preserves unrelated options", () => {
    expect(
      personalReasoningOptions(
        capabilities,
        [
          { id: "fastMode", value: false },
          { id: "thinking_budget", value: "high" },
        ],
        "medium",
      ),
    ).toEqual([
      { id: "fastMode", value: false },
      { id: "thinking_budget", value: "medium" },
    ]);
  });
  it("uses the saved preference on the next send", () => {
    expect(personalReasoningOptions(capabilities, undefined, "high")).toEqual([
      { id: "thinking_budget", value: "high" },
    ]);
    expect(personalReasoningOptions(capabilities, undefined, "xhigh")).toEqual([
      { id: "thinking_budget", value: "xhigh" },
    ]);
  });
  it("does not send an unsupported reasoning option", () => {
    const options = [{ id: "fastMode", value: true }];
    expect(personalReasoningOptions(capabilities, options, "low")).toBe(options);
    expect(personalReasoningOptions({}, undefined, "medium")).toBeUndefined();
  });
});
