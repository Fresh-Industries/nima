import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { studioChatActivity } from "./chatActivity";

const target = {
  environmentId: EnvironmentId.make("studio-host"),
  threadId: ThreadId.make("chat"),
  runId: RunId.make("current"),
  assetId: "artwork",
  revision: 8,
};
const call = {
  sourceThreadId: target.threadId,
  item: {
    type: "dynamic_tool",
    runId: target.runId,
    status: "completed" as const,
    toolName: "mcp__t3-code__t3_studio_edit",
    input: { id: target.assetId, operation: "artwork", expectedRevision: 7 },
    output: {
      content: [
        { type: "text", text: JSON.stringify({ current_revision: 8, request_id: "edit" }) },
      ],
    },
  },
};

it("attributes Studio activity only to the current conversation, run, host and artwork", () => {
  expect(studioChatActivity([call], target)).toBe("Updated from chat");
  for (const item of [
    { ...call, sourceThreadId: ThreadId.make("other-chat") },
    { ...call, item: { ...call.item, runId: RunId.make("old-run") } },
    { ...call, item: { ...call.item, toolName: "mcp__other-server__t3_studio_edit" } },
    { ...call, item: { ...call.item, input: { ...call.item.input, id: "other-artwork" } } },
    { ...call, item: { ...call.item, input: { ...call.item.input, environmentId: "other-host" } } },
    { ...call, item: { ...call.item, input: { ...call.item.input, operation: "studio" } } },
  ])
    expect(studioChatActivity([item], target)).toBeNull();
  expect(studioChatActivity([call], { ...target, runId: null })).toBeNull();
  const cursor = {
    ...call,
    item: {
      ...call.item,
      toolName: "t3_code/t3_studio_edit",
      input: { toolName: "t3_studio_edit", args: call.item.input },
    },
  };
  expect(studioChatActivity([cursor], target)).toBe("Updated from chat");
});

it("waits for a successful receipt and its matching canvas revision before reporting an update", () => {
  const unfinished = {
    ...call,
    item: { ...call.item, status: "running" as const, output: undefined },
  };
  expect(studioChatActivity([unfinished], target)).toBe("Editing from chat…");
  expect(studioChatActivity([call], { ...target, revision: 7 })).toBe("Updating canvas…");
  expect(studioChatActivity([call], { ...target, revision: 9 })).toBeNull();
  expect(
    studioChatActivity([{ ...call, item: { ...call.item, output: undefined } }], target),
  ).toBeNull();
  expect(
    studioChatActivity(
      [{ ...call, item: { ...call.item, output: { current_revision: 7 } } }],
      target,
    ),
  ).toBeNull();
  const failure = {
    ...call,
    item: {
      ...call.item,
      output: { isError: true, content: [{ type: "text", text: '{"current_revision":8}' }] },
    },
  };
  expect(studioChatActivity([failure], target)).toBe("Chat edit failed · see conversation");
  expect(
    studioChatActivity(
      [{ ...unfinished, item: { ...unfinished.item, status: "waiting" } }],
      target,
    ),
  ).toBe("Waiting on chat…");
  expect(
    studioChatActivity(
      [{ ...unfinished, item: { ...unfinished.item, status: "interrupted" } }],
      target,
    ),
  ).toBe("Studio activity stopped");
  const read = {
    ...call,
    item: {
      ...call.item,
      toolName: "t3_studio_inspect",
      input: { id: target.assetId, scope: "artwork" },
      status: "running" as const,
    },
  };
  expect(studioChatActivity([read], target)).toBe("Reading artwork…");
  expect(
    studioChatActivity([call, { ...read, item: { ...read.item, status: "completed" } }], target),
  ).toBe("Updated from chat");
});
