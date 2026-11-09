import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as PersonalAgent from "../../../personalAgent/PersonalAgent.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { idleThreadProjection, liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { MemoryToolkit } from "./tools.ts";

it.effect.each(["outside-client", "plan", "full-access", "worker", "delegated"] as const)(
  "enforces %s caller permissions independently of memory scope",
  (mode) => {
    const threadId = ThreadId.make(mode === "worker" ? "worker" : "assistant");
    const threadLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: (id) =>
        Effect.succeed(
          liveThreadShell(id, { interactionMode: mode === "plan" ? "plan" : "default" }),
        ),
      getThreadRecords: (id) => Effect.succeed(idleThreadProjection(liveThreadShell(id))),
    });
    const services = Layer.mergeAll(PersonalAgent.layer, threadLayer).pipe(
      Layer.provideMerge(Sqlite.layerMemory),
    );
    const layer = McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
      Layer.provideMerge(services),
      Layer.provideMerge(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("memory-test"),
          requestNamespace: "test",
          issuedAt: 0,
          capabilities: new Set(["orchestration"] as const),
          thread:
            mode === "outside-client"
              ? undefined
              : {
                  threadId,
                  providerSessionId: "session",
                  providerInstanceId: ProviderInstanceId.make("codex"),
                  subagent: mode === "delegated",
                },
          client:
            mode === "outside-client"
              ? { sessionId: "outside", label: "Outside", access: "full-access" }
              : undefined,
        }),
      ),
    );
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const at = "2026-11-05T12:00:00.000Z";
      for (const id of [ThreadId.make("assistant"), ThreadId.make("worker")])
        yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${id},'project',${id},'codex','full-access','default',${at},${at},'{}')`;
      const agent = yield* PersonalAgent.PersonalAgent;
      yield* agent.claimConversation(ThreadId.make("assistant"));
      yield* agent.remember(
        {
          scope: { kind: "personal" },
          key: "language",
          action: "remember",
          content: "PRIVATE_VALUE",
          sources: [],
          expectedRevision: 0,
        },
        { kind: "owner" },
      );
      const toolkit = yield* MemoryToolkit;
      const read = yield* toolkit
        .handle("t3_memory_read", { scope: { kind: "personal" } })
        .pipe(Stream.unwrap, Stream.runCollect);
      if (mode === "outside-client" || mode === "worker" || mode === "delegated")
        expect(read.at(-1)?.result).toMatchObject({
          code: mode === "outside-client" ? "thread_credential_required" : "capability_denied",
        });
      else
        expect(read.at(-1)?.result).toMatchObject({
          facts: [{ key: "language", content: "PRIVATE_VALUE", revision: 1 }],
        });
      const write = yield* toolkit
        .handle("t3_memory_write", {
          scope: { kind: "personal" },
          key: "language",
          action: "remember",
          content: "Corrected",
          sources: [],
          expectedRevision: 1,
        })
        .pipe(Stream.unwrap, Stream.runCollect);
      if (mode !== "full-access") {
        expect(write.at(-1)?.result).toMatchObject({
          code: mode === "outside-client" ? "thread_credential_required" : "capability_denied",
        });
        expect((yield* agent.memories({}, { kind: "owner" })).facts[0]?.revision).toBe(1);
      } else {
        expect(write.at(-1)?.result).toMatchObject({
          status: "saved",
          fact: {
            content: "Corrected",
            revision: 2,
            sources: [{ threadId: "assistant", messageId: null }],
          },
        });
      }
    }).pipe(Effect.provide(layer));
  },
);
