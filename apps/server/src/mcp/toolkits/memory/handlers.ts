import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PersonalAgent from "../../../personalAgent/PersonalAgent.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { MemoryToolkit } from "./tools.ts";
const caller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const thread = yield* McpInvocationContext.requireThreadScope(scope, "Memory tools");
  const threads = yield* ThreadManagement.ThreadManagementService;
  const records = yield* threads.getThreadRecords(thread.thread.threadId, ["runs"]).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "The calling conversation is unavailable.",
        }),
    ),
  );
  const run = records.runs
    .filter(
      (run) =>
        ThreadManagement.isActiveRun(run) &&
        run.providerInstanceId === thread.thread.providerInstanceId,
    )
    .sort((a, b) => b.ordinal - a.ordinal)[0];
  return {
    kind: "thread" as const,
    threadId: thread.thread.threadId,
    delegated: thread.thread.subagent === true,
    ...(run?.userMessageId ? { messageId: run.userMessageId } : {}),
  };
});
const failure = (cause: { reason: string; message: string }) =>
  new OrchestratorMcpFailure({
    code: cause.reason === "denied" ? "capability_denied" : "orchestration_error",
    message: cause.message,
  });
export const layer = McpToolAccess.toLayer(MemoryToolkit, {
  t3_memory_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const actor = yield* caller;
      return yield* (yield* PersonalAgent.PersonalAgent)
        .memories(input, actor)
        .pipe(Effect.mapError(failure));
    }),
  ),
  t3_memory_write: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const actor = yield* caller;
      return yield* (yield* PersonalAgent.PersonalAgent)
        .remember(
          {
            ...input,
            sources:
              input.action === "remember" && input.sources.length === 0
                ? [
                    {
                      label: "Conversation",
                      threadId: actor.threadId,
                      messageId: actor.messageId ?? null,
                    },
                  ]
                : input.sources,
          },
          actor,
        )
        .pipe(Effect.mapError(failure));
    }),
  ),
});
