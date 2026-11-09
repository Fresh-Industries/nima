import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ProjectTeams from "../../../bots/ProjectTeams.ts";
import * as Sqlite from "../../../persistence/Sqlite.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { BotsToolkit } from "./tools.ts";

it.effect.each(["local", "fenced-link", "no-capability", "outside-client"] as const)(
  "scopes Bot discovery for %s without returning private configuration",
  (mode) => {
    const threadId = ThreadId.make("caller");
    const services = Layer.mergeAll(
      BotStore.layer,
      Layer.mock(ProjectTeams.ProjectTeams)({ read: () => Effect.succeed({ teams: [] }) }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (id) =>
          Effect.succeed({
            ...liveThreadShell(id),
            ...(mode === "fenced-link"
              ? { linkOrigin: { sessionId: "link", label: "Remote", access: "auto" as const } }
              : {}),
          }),
      }),
    ).pipe(Layer.provideMerge(Sqlite.layerMemory));
    const layer = McpToolAccess.HandlersLayer.layer(Handlers.layer).pipe(
      Layer.provideMerge(services),
      Layer.provideMerge(
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("bots-test"),
          requestNamespace: "test",
          issuedAt: 0,
          capabilities: new Set(mode === "no-capability" ? [] : (["orchestration"] as const)),
          thread:
            mode === "outside-client"
              ? undefined
              : {
                  threadId,
                  providerSessionId: "session",
                  providerInstanceId: ProviderInstanceId.make("codex"),
                },
          client:
            mode === "outside-client"
              ? { sessionId: "client", label: "Outside", access: "full-access" as const }
              : undefined,
        }),
      ),
    );
    return Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const home = yield* bots.readHome();
      yield* bots.writeHome({
        config: { ...home.config, instructions: "PRIVATE_BOT_INSTRUCTIONS" },
        expectedRevision: home.revision,
      });
      const toolkit = yield* BotsToolkit;
      const responses = yield* toolkit
        .handle("t3_bot_list", {})
        .pipe(Stream.unwrap, Stream.runCollect);
      const result = responses.at(-1)?.result;
      if (mode === "local")
        expect(result).toMatchObject({ bots: [{ id: "primary", home: true }], team: null });
      else
        expect(result).toMatchObject({
          code: mode === "outside-client" ? "thread_credential_required" : "capability_denied",
        });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_BOT_INSTRUCTIONS");
    }).pipe(Effect.provide(layer));
  },
);
