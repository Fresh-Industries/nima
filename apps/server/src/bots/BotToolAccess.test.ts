import { assert, it } from "@effect/vitest";
import {
  BotId,
  HOME_BOT_ID,
  EnvironmentId,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
  DEFAULT_BOT_CAPABILITIES,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as PeerForwarding from "../peer/PeerForwarding.ts";
import * as BotStore from "./BotStore.ts";
import * as BotToolAccess from "./BotToolAccess.ts";

const probe = {
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.String,
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
};
const toolkit = Toolkit.make(
  Tool.make("t3_notes_read", probe).annotate(Tool.Readonly, true),
  // Unannotated tools must be treated as potentially mutating.
  Tool.make("t3_notes_write", probe),
  Tool.make("html_render", probe).annotate(Tool.Readonly, true),
  Tool.make("future_read", probe).annotate(Tool.Readonly, true),
);
const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make(0);
  const handlers = McpToolAccess.toLayer(toolkit, {
    t3_notes_read: McpToolAccess.reads(() =>
      Ref.update(calls, (n) => n + 1).pipe(Effect.as("read")),
    ),
    t3_notes_write: McpToolAccess.reads(() =>
      Ref.update(calls, (n) => n + 1).pipe(Effect.as("write")),
    ),
    html_render: McpToolAccess.reads(() => Effect.die("Read-only must not execute supplied HTML.")),
    future_read: McpToolAccess.reads(() => Effect.die("New tools require an explicit review.")),
  });
  const registration = McpHttpServer.toolkitRegistration(toolkit, handlers).pipe(
    Layer.provideMerge(McpHttpServer.layerInProcessMcpServer),
    Layer.provide(BotToolAccess.layer),
    Layer.provide(
      Layer.mock(PeerForwarding.PeerForwarding)({
        call: () =>
          Ref.update(calls, (n) => n + 1).pipe(
            Effect.andThen(Effect.die("Remote forwarding should have been refused.")),
          ),
      }),
    ),
  );
  return { calls, registration };
});
const scope = (
  threadId: ThreadId,
  provider = "codex",
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("here"),
  requestNamespace: "test",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  client: undefined,
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make(provider),
  },
});
const call = (
  tool: string,
  caller: McpInvocationContext.McpInvocationScope,
  remote = false,
  args?: Record<string, unknown>,
) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) =>
      server.callTool({
        name: tool,
        arguments: args ?? (remote ? { environmentId: "there" } : {}),
      }),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, caller),
    Effect.provideService(
      McpSchema.McpServerClient,
      McpSchema.McpServerClient.of({
        clientId: 1,
        protocolVersion: "2025-06-18",
        clientCapabilities: {},
        clientInfo: { name: "test", version: "1" },
        initializePayload: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
        getClient: Effect.die("unused"),
      }),
    ),
  );

it.effect(
  "requires an exact, current, single-use user approval and isolates project resources",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const chef = yield* bots.create({
        id: BotId.make("chef"),
        name: "Chef",
        description: "Cooking",
      });
      const thread = yield* bots.claimConversation(chef.id);
      const current = yield* bots.get(chef.id);
      yield* bots.write({
        id: chef.id,
        archived: false,
        expectedRevision: current.revision,
        config: {
          ...current.config,
          capabilities: {
            ...DEFAULT_BOT_CAPABILITIES,
            toolPolicy: { rules: [{ group: "knowledge", access: "approval" }], projectIds: null },
          },
        },
      });
      const { calls, registration } = yield* fixture;
      yield* Effect.gen(function* () {
        assert.isTrue((yield* call("t3_notes_write", scope(thread))).isError);
        assert.isTrue((yield* call("t3_notes_write", scope(thread))).isError);
        const approvals = (yield* bots.list()).approvals!;
        assert.equal(approvals.length, 1);
        assert.equal(yield* Ref.get(calls), 0);
        const request = approvals[0]!;
        const approved = yield* bots.resolveApproval({
          id: request.id,
          decision: "approved",
          expectedRevision: request.revision,
        });
        assert.equal(approved.status, "approved");
        assert.isTrue(
          (yield* call("t3_notes_write", scope(thread), false, { environmentId: "here" })).isError,
        );
        assert.equal(yield* Ref.get(calls), 0);
        assert.isNotTrue((yield* call("t3_notes_write", scope(thread))).isError);
        assert.equal(yield* Ref.get(calls), 1);
        assert.isTrue((yield* call("t3_notes_write", scope(thread))).isError);
        assert.equal(yield* Ref.get(calls), 1);
        const pending = (yield* bots.list()).approvals!.find((item) => item.id === request.id)!;
        const rejected = yield* bots.resolveApproval({
          id: request.id,
          decision: "rejected",
          expectedRevision: pending.revision,
        });
        assert.isTrue((yield* call("t3_notes_write", scope(thread))).isError);
        const reopened = yield* bots.resolveApproval({
          id: request.id,
          decision: "pending",
          expectedRevision: rejected.revision,
        });
        const profile = yield* bots.get(chef.id);
        yield* bots.write({
          id: chef.id,
          archived: false,
          expectedRevision: profile.revision,
          config: { ...profile.config, instructions: "Changed policy context" },
        });
        assert.equal(
          (yield* bots.resolveApproval({
            id: request.id,
            decision: "approved",
            expectedRevision: reopened.revision,
          })).status,
          "invalidated",
        );
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO projection_projects(project_id,title,workspace_root,scripts_json,created_at,updated_at) VALUES('a','Allowed','/a','[]','2026-11-05','2026-11-05')`;
        const latest = yield* bots.get(chef.id);
        const restricted = yield* bots.write({
          id: chef.id,
          archived: false,
          expectedRevision: latest.revision,
          config: {
            ...latest.config,
            capabilities: {
              ...DEFAULT_BOT_CAPABILITIES,
              toolPolicy: { rules: [], projectIds: [ProjectId.make("a")] },
            },
          },
        });
        assert.isTrue(
          yield* bots.allowsResources(
            thread,
            "here",
            "t3_project_read",
            { projectId: "a" },
            restricted.bot,
          ),
        );
        assert.isFalse(
          yield* bots.allowsResources(
            thread,
            "here",
            "t3_project_read",
            { projectId: "b" },
            restricted.bot,
          ),
        );
        assert.isFalse(
          yield* bots.allowsResources(
            thread,
            "here",
            "t3_thread_send",
            { target: { environmentId: "there", projectId: "a" } },
            restricted.bot,
          ),
        );
        assert.isFalse(
          yield* bots.allowsResources(
            thread,
            "here",
            "t3_thread_list",
            { allProjects: true },
            restricted.bot,
          ),
        );
      }).pipe(Effect.provide(registration));
    }).pipe(Effect.provide(BotStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);

it.effect(
  "enforces current Bot permissions before local and remote tool dispatch across provider changes",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const chef = yield* bots.create({
        id: BotId.make("chef"),
        name: "Chef",
        description: "Cook",
      });
      const chefThread = yield* bots.claimConversation(chef.id);
      const home = yield* bots.claimConversation(HOME_BOT_ID);
      const { registration, calls } = yield* fixture;
      yield* Effect.gen(function* () {
        assert.isNotTrue((yield* call("t3_notes_write", scope(chefThread))).isError);
        const current = yield* bots.get(chef.id);
        const restricted = yield* bots.write({
          id: chef.id,
          config: { ...current.config, toolAccess: "read-only" },
          expectedRevision: current.revision,
          archived: false,
        });
        assert.isTrue((yield* call("t3_notes_write", scope(chefThread))).isError);
        assert.isTrue((yield* call("t3_notes_write", scope(chefThread, "claude"), true)).isError);
        assert.isTrue((yield* call("html_render", scope(chefThread))).isError);
        assert.isTrue((yield* call("future_read", scope(chefThread))).isError);
        assert.equal(yield* Ref.get(calls), 1);
        assert.isNotTrue((yield* call("t3_notes_read", scope(chefThread))).isError);
        assert.isNotTrue((yield* call("t3_notes_write", scope(home))).isError);
        const blocked = yield* bots.write({
          id: chef.id,
          config: { ...restricted.bot.config, toolAccess: "blocked" },
          expectedRevision: restricted.bot.revision,
          archived: false,
        });
        assert.isTrue((yield* call("t3_notes_read", scope(chefThread))).isError);
        assert.equal(yield* Ref.get(calls), 3);
        yield* bots.write({
          id: chef.id,
          config: { ...blocked.bot.config, toolAccess: "allowed" },
          expectedRevision: blocked.bot.revision,
          archived: false,
        });
        assert.isNotTrue((yield* call("t3_notes_write", scope(chefThread))).isError);
        assert.equal(yield* Ref.get(calls), 4);
      }).pipe(Effect.provide(registration));
    }).pipe(Effect.provide(BotStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);

it.effect(
  "intersects routine Work, delegated Bot and native worker policies, failing closed on corrupt lineage",
  () =>
    Effect.gen(function* () {
      const bots = yield* BotStore.BotStore;
      const sql = yield* SqlClient.SqlClient;
      const home = yield* bots.get(HOME_BOT_ID);
      const parent = yield* bots.claimConversation(HOME_BOT_ID);
      const lead = yield* bots.create({
        id: BotId.make("lead"),
        name: "Lead",
        description: "Coordinate",
      });
      yield* bots.write({
        id: home.id,
        config: { ...home.config, toolAccess: "read-only" },
        expectedRevision: (yield* bots.get(home.id)).revision,
        archived: false,
      });
      const work = ThreadId.make("work"),
        child = ThreadId.make("native-child");
      yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,coordinator_bot_id,configuration_revision) VALUES(${work},'focus','Routine','Research','2026-11-05',${lead.id},1)`;
      yield* sql`INSERT INTO workspace_bot_delegations(thread_id,parent_thread_id,root_thread_id,depth,state,title,objective) VALUES(${work},${parent},${parent},1,'started','Research','Research')`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,payload_json) VALUES(${child},'scratch','Worker','codex','full-access','default','2026-11-05','2026-11-05',${JSON.stringify({ lineage: { relationshipToParent: "subagent", parentThreadId: work } })})`;
      assert.equal(yield* bots.toolAccessForThread(work), "read-only");
      assert.equal(yield* bots.toolAccessForThread(child), "read-only");
      yield* bots.markConversation(HOME_BOT_ID);
      yield* sql`INSERT INTO orchestration_v2_projection_threads(thread_id,project_id,title,default_provider,runtime_mode,interaction_mode,created_at,updated_at,deleted_at,payload_json) VALUES(${parent},'scratch','Replaced relationship','codex','full-access','default','2026-11-05','2026-11-05','2026-11-05','{}')`;
      assert.notEqual(yield* bots.claimConversation(HOME_BOT_ID), parent);
      assert.equal(yield* bots.toolAccessForThread(child), "read-only");
      assert.equal(yield* bots.toolAccessForThread(ThreadId.make("unrelated")), "allowed");
      const saved = yield* bots.write({
        id: lead.id,
        config: { ...lead.config, toolAccess: "blocked" },
        expectedRevision: lead.revision,
        archived: false,
      });
      assert.equal(yield* bots.toolAccessForThread(child), "blocked");
      yield* bots.write({
        id: lead.id,
        config: { ...saved.bot.config, toolAccess: "allowed" },
        expectedRevision: saved.bot.revision,
        archived: false,
      });
      yield* sql`UPDATE workspace_bot_delegations SET parent_thread_id=${child} WHERE thread_id=${work}`;
      const guard = yield* BotToolAccess.BotToolAccess;
      assert.equal(
        (yield* guard.check(scope(child), "t3_notes_read", true).pipe(Effect.flip)).code,
        "capability_denied",
      );
    }).pipe(
      Effect.provide(
        BotToolAccess.layer.pipe(
          Layer.provideMerge(BotStore.layer),
          Layer.provideMerge(Sqlite.layerMemory),
        ),
      ),
    ),
);
