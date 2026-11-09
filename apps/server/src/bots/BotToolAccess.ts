import { OrchestratorMcpFailure, type BotToolGroup } from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as BotStore from "./BotStore.ts";

// Protocol readOnlyHint is advisory, not an authorization boundary. Admit only
// reviewed observations as well as the hint. New tools fail closed in read-only mode.
// html_render/html_preview execute caller-supplied code, despite their read-only hints.
const readOnlyTools = new Set([
  "orchestrator_capabilities",
  "list_scheduled_tasks",
  "t3_bot_list",
  "t3_thread_list",
  "t3_thread_read",
  "t3_thread_wait",
  "t3_thread_search",
  "t3_environment_read",
  "t3_environment_links",
  "t3_project_list",
  "t3_project_read",
  "t3_worktree_status",
  "t3_worktree_list",
  "t3_memory_read",
  "t3_notes_read",
  "t3_pages_list",
  "t3_pages_read",
  "t3_goals_list",
  "t3_goals_read",
  "t3_goals_history",
  "t3_studio_inspect",
  "t3_preview_list",
  "preview_status",
  "preview_snapshot",
  "preview_wait_for",
  "device_list",
  "device_screenshot",
  "list_thread_pull_requests",
  "read_pull_request_guide",
]);
const groupFor = (tool: string): BotToolGroup =>
  /^t3_(memory|notes|pages|goals)_/.test(tool)
    ? "knowledge"
    : /^(preview_|device_|t3_preview_)/.test(tool)
      ? "browser"
      : /^(t3_studio_|html_)/.test(tool)
        ? "studio"
        : /^(t3_(thread_|bot_|queue|pending_request|workflow_|background_)|delegate_task|create_threads|schedule_task|list_scheduled_tasks|delete_scheduled_task|task_|orchestrator_capabilities)/.test(
              tool,
            )
          ? "work"
          : "environment";
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
const encodeUnknown = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export class BotToolAccess extends Context.Service<
  BotToolAccess,
  {
    readonly check: (
      scope: McpInvocationScope,
      tool: string,
      readOnlyHint: boolean,
      args?: unknown,
    ) => Effect.Effect<void, OrchestratorMcpFailure>;
  }
>()("t3/bots/BotToolAccess") {}

export const layer = Layer.effect(
  BotToolAccess,
  Effect.gen(function* () {
    const bots = yield* BotStore.BotStore;
    const digest = yield* Digest.Digest;
    return BotToolAccess.of({
      check: Effect.fn("BotToolAccess.check")(function* (scope, tool, readOnlyHint, args) {
        // Outside MCP clients retain their OAuth permissions. Naming a Bot's
        // thread in arguments cannot acquire that Bot's identity or permissions.
        if (!scope.thread) return;
        const profiles = yield* bots.policiesForThread(scope.thread.threadId).pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({
                code: "capability_denied",
                message:
                  "Could not verify this Bot's Bara tool permissions. Try again after reconnecting.",
              }),
          ),
        );
        let approval = false;
        const readOnly = readOnlyHint && readOnlyTools.has(tool);
        for (const profile of profiles) {
          const rule = profile.config.capabilities?.toolPolicy.rules.find(
            (rule) => rule.group === groupFor(tool),
          )?.access;
          const levels = [profile.config.toolAccess ?? "allowed", rule ?? "allowed"];
          if (levels.includes("blocked") || (!readOnly && levels.includes("read-only")))
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                "This Bot or its coordinating ancestor does not permit this Bara tool. Check its tool access settings.",
            });
          const authorized = yield* bots
            .allowsResources(scope.thread.threadId, scope.environmentId, tool, args ?? {}, profile)
            .pipe(
              Effect.mapError(
                () =>
                  new OrchestratorMcpFailure({
                    code: "capability_denied",
                    message: "Could not verify the requested resource permissions.",
                  }),
              ),
            );
          if (!authorized)
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                "This Bot or its coordinating ancestor is not authorized for that project or broad resource discovery. Use an allowed project on this host.",
            });
          if (!readOnly && rule === "approval") approval = true;
        }
        if (approval) {
          const argumentsJson = encodeUnknown(canonical(args ?? {}));
          if (argumentsJson.length > 16000)
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                "This action is too large for a permission review. Prepare a smaller action.",
            });
          const resource = yield* bots.approvalContext(scope.thread.threadId).pipe(
            Effect.mapError(
              () =>
                new OrchestratorMcpFailure({
                  code: "capability_denied",
                  message: "Could not verify this action’s current resources.",
                }),
            ),
          );
          const bytes = yield* digest
            .digest(
              Digest.sha256,
              new TextEncoder().encode(
                encodeUnknown([
                  scope.thread.threadId,
                  tool,
                  argumentsJson,
                  resource,
                  profiles.map((p) => [p.id, p.revision]),
                ]),
              ),
            )
            .pipe(Effect.orDie);
          const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
          const decision = yield* bots
            .approveToolCall({
              id,
              threadId: scope.thread.threadId,
              tool,
              arguments: argumentsJson,
              profiles,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new OrchestratorMcpFailure({
                    code: "capability_denied",
                    message: "Could not prepare this action's permission review.",
                  }),
              ),
            );
          if (decision !== "approved")
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                decision === "rejected"
                  ? "The user declined this exact action. Do not retry it without new authorization."
                  : `Action requires user approval in Inbox (${id}). No action ran. After approval, retry this exact call once; existing provider permissions still apply.`,
            });
        }
      }),
    });
  }),
).pipe(Layer.provide(NodeCrypto.layer));
