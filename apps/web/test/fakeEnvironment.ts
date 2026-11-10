// An in-process environment for app render scenarios: a fetch stub for its HTTP API and a
// session that answers the shell, thread and config subscriptions from fixtures. Other RPCs
// stay pending so nothing retries on timers. Everything above the wire is the app's own.
import {
  AuthStandardClientScopes,
  EnvironmentId,
  EventId,
  ExecutionEnvironmentDescriptor,
  MessageId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_V2_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTask,
  ScheduledTaskId,
  type ScheduledTaskUpsertInput,
  ServerConfig,
  ThreadId,
  TurnItemId,
  WS_METHODS,
  WsRpcGroup,
  type ProjectTeam,
  type ProjectTeamsSnapshot,
  type ProjectTeamWriteInput,
  type BotProfile,
  type BotToolApproval,
  type BotApprovalResolveInput,
  type WorkSessionCreateInput,
  type WorkspaceReviewWriteInput,
  type BotCreateInput,
  type BotWriteInput,
  type BotsSnapshot,
  type VcsStatusStreamEvent,
  type OrchestrationProjectShell,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2Run,
  type OrchestrationV2ShellStreamItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem,
  type WorkspaceReviewSnapshot,
  type TerminalMetadataStreamEvent,
} from "@t3tools/contracts";
import type {
  ConnectionAttemptError,
  ConnectionCatalogEntry,
  EnvironmentConnectionLease,
  RouteCheck,
} from "@t3tools/client-runtime/connection";
import type { WsRpcProtocolClient } from "@t3tools/client-runtime/rpc";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { APP_VERSION } from "~/branding";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { RpcSchema } from "effect/rpc";

export const ENVIRONMENT_ID = EnvironmentId.make("environment-render");
export const PROJECT_ID = ProjectId.make("project-render");
const CODEX = ProviderInstanceId.make("codex");
const MODEL = { instanceId: CODEX, model: "gpt-5.4" };
const decodeScheduledTask = Schema.decodeUnknownEffect(ScheduledTask);
const AT = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");

const descriptor = {
  environmentId: ENVIRONMENT_ID,
  label: "Render scenarios",
  platform: { os: "linux", arch: "x64" },
  // A matching version, since a mismatch adds an update banner a typical user never sees.
  serverVersion: APP_VERSION,
  orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
  capabilities: {
    repositoryIdentity: true,
    botRoutines: true,
    botToolAccess: true,
    botCapabilities: true,
    oneTimeSchedules: true,
  },
};
const auth = {
  policy: "loopback-browser",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["browser-session-cookie"],
  sessionCookieName: "t3_session",
};

const serverConfig: ServerConfig = {
  ...Schema.decodeUnknownSync(ServerConfig)({
    environment: descriptor,
    auth,
    cwd: "/workspace/render",
    scratchWorkspaceRoot: "/workspace/scratch-render",
    keybindingsConfigPath: "/workspace/.t3/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        instanceId: CODEX,
        driver: "codex",
        enabled: true,
        installed: true,
        version: "1.0.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-03-17T19:12:28.000Z",
        models: [{ slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, capabilities: null }],
      },
    ],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/workspace/.t3/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: {},
    threadSnapshotPagination: true,
    threadResumeCompletionMarker: true,
    shellResumeCompletionMarker: true,
  }),
  keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
};

const project: OrchestrationProjectShell = {
  id: PROJECT_ID,
  title: "render",
  workspaceRoot: "/workspace/render",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-03-17T19:12:28.000Z",
  updatedAt: "2026-03-17T19:12:28.000Z",
};

const base = (threadId: ThreadId, runId: RunId, id: string, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: AT,
  completedAt: AT,
  updatedAt: AT,
});

function userItem(threadId: ThreadId, runId: RunId, id: string, ordinal: number, text: string) {
  return {
    ...base(threadId, runId, id, ordinal),
    type: "user_message",
    messageId: MessageId.make(id),
    text,
    attachments: [],
    inputIntent: "turn_start",
    createdBy: "user",
    creationSource: "web",
  } satisfies OrchestrationV2TurnItem;
}

export function assistantItem(
  threadId: ThreadId,
  runId: RunId,
  id: string,
  ordinal: number,
  text: string,
  streaming = false,
) {
  return {
    ...base(threadId, runId, id, ordinal),
    type: "assistant_message",
    messageId: MessageId.make(id),
    text,
    streaming,
    ...(streaming ? { status: "running" as const, completedAt: null } : {}),
  } satisfies OrchestrationV2TurnItem;
}

function run(threadId: ThreadId, id: RunId, ordinal: number, userMessageId: string) {
  return {
    id,
    threadId,
    ordinal,
    providerInstanceId: CODEX,
    modelSelection: MODEL,
    providerThreadId: null,
    userMessageId: MessageId.make(userMessageId),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: AT,
    startedAt: AT,
    completedAt: AT,
    checkpointId: null,
    contextHandoffId: null,
  } satisfies OrchestrationV2Run;
}

export interface FakeThread {
  readonly settled?: boolean;
  /** Makes this a side chat of that thread. */
  readonly sideChatOf?: ThreadId;
  readonly id: ThreadId;
  readonly title: string;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly subagents?: OrchestrationV2ThreadProjection["subagents"];
  readonly messages?: OrchestrationV2ThreadProjection["messages"];
}

/** A thread of `turns` user prompts, each answered in markdown with a list and inline code. */
export function threadWithHistory(name: string, turns: number): FakeThread {
  const id = ThreadId.make(name);
  const runs: OrchestrationV2Run[] = [];
  const items: OrchestrationV2TurnItem[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const runId = RunId.make(`${name}-run-${turn}`);
    runs.push(run(id, runId, turn + 1, `${name}-user-${turn}`));
    items.push(
      userItem(id, runId, `${name}-user-${turn}`, turn * 2, `${name}: question ${turn}`),
      assistantItem(
        id,
        runId,
        `${name}-assistant-${turn}`,
        turn * 2 + 1,
        `Answer ${turn} for ${name}.\n\n- checked \`Sidebar.tsx\`\n- ran the tests\n\n` +
          "The width is now `clamp(next, MIN_WIDTH, MAX_WIDTH)`, so the layout no longer jumps.",
      ),
    );
  }
  return { id, title: `Thread ${name}`, runs, items };
}

function shellOf(thread: FakeThread): OrchestrationV2ThreadShell {
  const latest = thread.runs.at(-1);
  return {
    id: thread.id,
    projectId: PROJECT_ID,
    title: thread.title,
    providerInstanceId: CODEX,
    modelSelection: MODEL,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: thread.sideChatOf ?? thread.id,
      parentThreadId: thread.sideChatOf ?? null,
      relationshipToParent: null,
      ...(thread.sideChatOf ? { sideChat: true } : {}),
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: latest?.id ?? null,
    activeRunId: null,
    // Idle reads as waiting on the user, which shows a per-second duration in the sidebar.
    status: latest ? "completed" : "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: AT,
    hasActionableProposedPlan: false,
    itemCount: thread.items.length,
    visibleItemCount: thread.items.length,
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    settledOverride: thread.settled ? "settled" : null,
    settledAt: thread.settled ? AT : null,
    lastVisitedAt: AT,
    deletedAt: null,
  };
}

function projectionOf(thread: FakeThread): OrchestrationV2ThreadProjection {
  const shell = shellOf(thread);
  const visibleTurnItems: OrchestrationV2ProjectedTurnItem[] = thread.items.map(
    (item, position) => ({
      position,
      visibility: "local",
      sourceThreadId: thread.id,
      sourceItemId: item.id,
      item,
    }),
  );
  return {
    thread: {
      id: shell.id,
      projectId: shell.projectId,
      title: shell.title,
      providerInstanceId: shell.providerInstanceId,
      modelSelection: shell.modelSelection,
      runtimeMode: shell.runtimeMode,
      interactionMode: shell.interactionMode,
      branch: shell.branch,
      worktreePath: shell.worktreePath,
      activeProviderThreadId: null,
      lineage: shell.lineage,
      forkedFrom: null,
      createdBy: "user",
      creationSource: "web",
      createdAt: AT,
      updatedAt: AT,
      archivedAt: null,
      settledOverride: shell.settledOverride,
      settledAt: shell.settledAt,
      lastVisitedAt: AT,
      deletedAt: null,
    },
    runs: [...thread.runs],
    attempts: [],
    nodes: [],
    subagents: [...(thread.subagents ?? [])],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [...(thread.messages ?? [])],
    plans: [],
    turnItems: [...thread.items],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems,
    updatedAt: AT,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Keyed by thread id: a live thread subscription's queue, for pushing events to it.
const threadSubscribers = new Map<string, Queue.Queue<OrchestrationV2ThreadStreamItem>>();
let terminalMetadataSubscriber: Queue.Queue<TerminalMetadataStreamEvent> | null = null;
let threads: ReadonlyArray<FakeThread> = [];
let sequence = 1;
let vcsStatusSubscriber: Queue.Queue<VcsStatusStreamEvent> | null = null;

const subscribe = <A>(first: ReadonlyArray<A>, register?: (queue: Queue.Queue<A>) => () => void) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<A>();
      yield* Queue.offerAll(queue, first);
      if (register) {
        const unregister = register(queue);
        yield* Effect.addFinalizer(() => Effect.sync(unregister));
      }
      return Stream.fromQueue(queue);
    }),
  );

const handlers: Record<string, (input: never) => unknown> = {
  [WS_METHODS.projectsEnsureScratch]: () =>
    Effect.gen(function* () {
      scratchOpened = true;
      for (const queue of shellSubscribers)
        yield* Queue.offer(queue, {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1,
            snapshotSequence: ++sequence,
            projects: [project, scratchProject],
            threads: threads.map(shellOf),
            archivedThreads: [],
          },
        });
      return { projectId: scratchProject.id };
    }),
  [WS_METHODS.scheduledTasksSubscribe]: () =>
    subscribe([{ tasks: tasksFixture }], (queue) => {
      taskSubscribers.add(queue);
      return () => {
        taskSubscribers.delete(queue);
      };
    }),
  [WS_METHODS.scheduledTasksUpsert]: (input: ScheduledTaskUpsertInput) =>
    Effect.gen(function* () {
      const old = tasksFixture.find((task) => task.id === input.id);
      const task = yield* decodeScheduledTask({
        ...input,
        id: old?.id ?? ScheduledTaskId.make(`routine-render-${tasksFixture.length + 1}`),
        threadId: input.threadId ?? null,
        createdBy: "user",
        creationSource: "web",
        createdAt: old?.createdAt ?? DateTime.formatIso(AT),
        updatedAt: DateTime.formatIso(AT),
        nextRunAt: "2026-11-06T09:00:00.000Z",
        lastRunAt: null,
        lastRunStatus: "never",
        lastRunError: null,
        runCount: 0,
      });
      tasksFixture = [...tasksFixture.filter((entry) => entry.id !== task.id), task];
      for (const queue of taskSubscribers) yield* Queue.offer(queue, { tasks: tasksFixture });
      return { task };
    }),
  [WS_METHODS.scheduledTasksSetEnabled]: (input: { id: ScheduledTaskId; enabled: boolean }) =>
    Effect.gen(function* () {
      const old = tasksFixture.find((task) => task.id === input.id);
      if (!old) throw new Error("Missing routine fixture");
      const task = { ...old, enabled: input.enabled };
      tasksFixture = tasksFixture.map((entry) => (entry.id === task.id ? task : entry));
      for (const queue of taskSubscribers) yield* Queue.offer(queue, { tasks: tasksFixture });
      return { task };
    }),
  [WS_METHODS.scheduledTasksListRuns]: () => Effect.succeed({ runs: [], nextCursor: null }),

  [WS_METHODS.projectTeamsSubscribe]: () =>
    subscribe<ProjectTeamsSnapshot>([{ teams: teamsFixture }], (queue) => {
      teamSubscribers.add(queue);
      return () => {
        teamSubscribers.delete(queue);
      };
    }),
  [WS_METHODS.projectTeamsWrite]: (input: ProjectTeamWriteInput) =>
    Effect.gen(function* () {
      const current = teamsFixture.find((team) => team.projectId === input.projectId) ?? {
        projectId: input.projectId,
        members: [],
        revision: 0,
      };
      if (current.revision !== input.expectedRevision) return { status: "conflict", team: current };
      const team = {
        projectId: input.projectId,
        members: input.members,
        revision: current.revision + 1,
      };
      teamsFixture = [...teamsFixture.filter((entry) => entry.projectId !== team.projectId), team];
      for (const queue of teamSubscribers) yield* Queue.offer(queue, { teams: teamsFixture });
      return { status: "saved", team };
    }),
  [WS_METHODS.botsSubscribe]: () =>
    botsFixture
      ? subscribe<BotsSnapshot>([{ bots: botsFixture, approvals: approvalsFixture }], (queue) => {
          botsSubscriber = queue;
          return () => {
            if (botsSubscriber === queue) botsSubscriber = null;
          };
        })
      : Stream.never,
  [WS_METHODS.botsResolveApproval]: (input: BotApprovalResolveInput) =>
    Effect.gen(function* () {
      const item = approvalsFixture.find((item) => item.id === input.id);
      if (!item || item.revision !== input.expectedRevision) throw new Error("Review changed");
      const next = { ...item, status: input.decision, revision: item.revision + 1 };
      approvalsFixture = approvalsFixture.map((item) => (item.id === input.id ? next : item));
      if (botsSubscriber)
        yield* Queue.offer(botsSubscriber, {
          bots: botsFixture ?? [],
          approvals: approvalsFixture,
        });
      return next;
    }),
  [WS_METHODS.botsCreate]: (input: BotCreateInput) =>
    Effect.gen(function* () {
      const bot: BotProfile = {
        id: input.id,
        home: false,
        config: {
          name: input.name,
          description: input.description,
          avatar: "",
          instructions: "",
          timezone: "UTC",
          reasoning: "xhigh",
          modelSelection: null,
        },
        threadId: threads[0]?.id ?? null,
        revision: 0,
        archived: false,
        updatedAt: DateTime.formatIso(AT),
      };
      botsFixture = [...(botsFixture ?? []), bot];
      if (botsSubscriber)
        yield* Queue.offer(botsSubscriber, { bots: botsFixture, approvals: approvalsFixture });
      return bot;
    }),
  [WS_METHODS.botsWrite]: (input: BotWriteInput) =>
    Effect.gen(function* () {
      const previous = botsFixture?.find((bot) => bot.id === input.id);
      if (!previous) throw new Error("Missing bot fixture");
      const bot = {
        ...previous,
        config: input.config,
        archived: input.archived,
        revision: previous.revision + 1,
      };
      botsFixture = botsFixture!.map((entry) => (entry.id === bot.id ? bot : entry));
      if (botsSubscriber)
        yield* Queue.offer(botsSubscriber, { bots: botsFixture, approvals: approvalsFixture });
      return { status: "saved", bot };
    }),
  [WS_METHODS.botsOpen]: (input: { id: BotProfile["id"] }) =>
    Effect.sync(() => {
      const bot = botsFixture?.find((bot) => bot.id === input.id);
      if (!bot) throw new Error("Missing bot fixture");
      return bot;
    }),
  [WS_METHODS.workspaceReviewSubscribe]: () =>
    inboxFixture
      ? subscribe([inboxFixture], (queue) => {
          reviewSubscribers.add(queue);
          return () => {
            reviewSubscribers.delete(queue);
          };
        })
      : Stream.never,
  [WS_METHODS.workspaceWorkCreate]: (input: WorkSessionCreateInput) =>
    Effect.gen(function* () {
      threads = [...threads, { ...threadWithHistory(input.threadId, 0), title: input.title }];
      inboxFixture = {
        items: [],
        pendingCount: 0,
        nextCursor: null,
        ...inboxFixture,
        metadata: [
          ...(inboxFixture?.metadata ?? []),
          {
            threadId: input.threadId,
            kind: "focus",
            title: input.title,
            objective: input.objective,
            state: "active",
            version: null,
            latestRunIsBot: false,
            scopeProjectId: input.projectId,
            coordinatorBotId: input.coordinatorBotId,
            configurationRevision: 1,
            workPending: false,
          },
        ],
      };
      for (const queue of reviewSubscribers) yield* Queue.offer(queue, inboxFixture);
      for (const queue of shellSubscribers)
        yield* Queue.offer(queue, {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1,
            snapshotSequence: sequence,
            projects: scratchOpened ? [project, scratchProject] : [project],
            threads: threads.map(shellOf),
            archivedThreads: [],
          },
        });
      return { threadId: input.threadId };
    }),
  [WS_METHODS.workspaceReviewWrite]: (input: WorkspaceReviewWriteInput) =>
    Effect.gen(function* () {
      if (input.action === "request" && inboxFixture) {
        const meta = inboxFixture.metadata.find((entry) => entry.threadId === input.threadId);
        if (!meta) throw new Error("Missing Work fixture");
        const key = `focus:${input.threadId}`;
        const item = {
          key,
          version: "manual",
          kind: "focus" as const,
          threadId: input.threadId,
          runId: null,
          botId: null,
          title: meta.title ?? "Work",
          summary: meta.objective ?? "",
          completedAt: "2026-03-17T19:12:28.000Z",
          status: null,
          state: "review" as const,
        };
        const items = [...inboxFixture.items.filter((entry) => entry.key !== key), item];
        inboxFixture = {
          ...inboxFixture,
          items,
          pendingCount: items.length,
          metadata: inboxFixture.metadata.map((entry) =>
            entry.threadId === input.threadId
              ? { ...entry, state: "review" as const, version: "manual" }
              : entry,
          ),
        };
        for (const queue of reviewSubscribers) yield* Queue.offer(queue, inboxFixture);
      }
      if (input.action === "coordinate" && inboxFixture) {
        inboxFixture = {
          ...inboxFixture,
          metadata: inboxFixture.metadata.map((meta) =>
            meta.threadId === input.threadId
              ? {
                  ...meta,
                  coordinatorBotId: input.coordinatorBotId,
                  configurationRevision: (meta.configurationRevision ?? 0) + 1,
                }
              : meta,
          ),
        };
        for (const queue of reviewSubscribers) yield* Queue.offer(queue, inboxFixture);
      }
      return {};
    }),
  [WS_METHODS.subscribeTerminalMetadata]: () =>
    subscribe<TerminalMetadataStreamEvent>([{ type: "snapshot", terminals: [] }], (queue) => {
      terminalMetadataSubscriber = queue;
      return () => {
        if (terminalMetadataSubscriber === queue) terminalMetadataSubscriber = null;
      };
    }),
  [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () =>
    subscribe<OrchestrationV2ShellStreamItem>(
      [
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1,
            snapshotSequence: sequence,
            projects: scratchOpened ? [project, scratchProject] : [project],
            threads: threads.map(shellOf),
            archivedThreads: [],
          },
        },
        { kind: "synchronized" },
      ],
      (queue) => {
        shellSubscribers.add(queue);
        return () => {
          shellSubscribers.delete(queue);
        };
      },
    ),
  [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: (input: { readonly threadId: ThreadId }) => {
    const thread = threads.find((candidate) => candidate.id === input.threadId);
    if (!thread) return Stream.never;
    return subscribe<OrchestrationV2ThreadStreamItem>(
      [
        { kind: "snapshot", snapshotSequence: sequence, projection: projectionOf(thread) },
        { kind: "synchronized" },
      ],
      (queue) => {
        threadSubscribers.set(thread.id, queue);

        // A replaced subscription closes after its successor registers.
        return () => {
          if (threadSubscribers.get(thread.id) === queue) threadSubscribers.delete(thread.id);
        };
      },
    );
  },
  [WS_METHODS.subscribeVcsStatus]: () =>
    subscribe<VcsStatusStreamEvent>([], (queue) => {
      vcsStatusSubscriber = queue;
      return () => {
        if (vcsStatusSubscriber === queue) vcsStatusSubscriber = null;
      };
    }),
  [WS_METHODS.subscribeServerConfig]: () =>
    subscribe([{ version: 1 as const, type: "snapshot" as const, config: serverConfig }]),
};

// Unanswered calls stay pending, like a server that has not replied yet.
const client = new Proxy(handlers, {
  get: (target, method: string) =>
    target[method] ??
    (() => {
      const rpc = WsRpcGroup.requests.get(method);
      return rpc && RpcSchema.isStreamSchema(rpc.successSchema) ? Stream.never : Effect.never;
    }),
});

const session: EnvironmentConnectionLease["session"] = {
  client: client as unknown as WsRpcProtocolClient,
  initialConfig: Effect.succeed(serverConfig),
  subscribeServerConfig: () =>
    subscribe([{ version: 1 as const, type: "snapshot" as const, config: serverConfig }]),
  ready: Effect.void,
  probe: Effect.void,
  inboundFrames: Effect.succeed(0),
  closed: Effect.never,
};

/** Stands in for client-runtime's ConnectionDriver: every connection opens the session above. */
export const fakeDriver = {
  connect: (
    entry: ConnectionCatalogEntry,
  ): Effect.Effect<EnvironmentConnectionLease, ConnectionAttemptError, Scope.Scope> =>
    Effect.succeed({
      prepared: {
        environmentId: ENVIRONMENT_ID,
        label: descriptor.label,
        httpBaseUrl: window.location.origin,
        socketUrl: window.location.origin.replace(/^http/, "ws"),
        httpAuthorization: null,
        target: entry.target,
      },
      session,
    }),
  preflight: () => Effect.succeed(true),
  checkHost: () => Effect.succeed<RouteCheck>("unchecked"),
};
export type FakeDriver = typeof fakeDriver;

const realFetch = globalThis.fetch;
const scratchProject = {
  ...project,
  id: ProjectId.make("project-scratch-render"),
  title: "Scratch",
  workspaceRoot: "/workspace/scratch-render",
};
let scratchOpened = false;
let tasksFixture: ReadonlyArray<ScheduledTask> = [];
const taskSubscribers = new Set<Queue.Queue<{ tasks: ReadonlyArray<ScheduledTask> }>>();
let inboxFixture: WorkspaceReviewSnapshot | undefined;
let teamsFixture: ReadonlyArray<ProjectTeam> = [];
const teamSubscribers = new Set<Queue.Queue<ProjectTeamsSnapshot>>();
let approvalsFixture: ReadonlyArray<BotToolApproval> = [];
let botsFixture: ReadonlyArray<BotProfile> | undefined;
let botsSubscriber: Queue.Queue<BotsSnapshot> | null = null;
const reviewSubscribers = new Set<Queue.Queue<WorkspaceReviewSnapshot>>();
const shellSubscribers = new Set<Queue.Queue<OrchestrationV2ShellStreamItem>>();
const encodedDescriptor = Schema.encodeSync(ExecutionEnvironmentDescriptor)(
  Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor)(descriptor),
);

/** Serves the environment's HTTP API and these threads until disposed. */
export function installFakeEnvironment(
  fixtures: ReadonlyArray<FakeThread>,
  inbox?: WorkspaceReviewSnapshot,
  bots?: ReadonlyArray<BotProfile>,
  teams: ReadonlyArray<ProjectTeam> = [],
  approvals: ReadonlyArray<BotToolApproval> = [],
): Disposable {
  threads = fixtures;
  inboxFixture = inbox;
  botsFixture = bots;
  approvalsFixture = approvals;
  teamsFixture = teams;
  tasksFixture = [];
  scratchOpened = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.origin !== window.location.origin) return realFetch(input, init);
    if (url.pathname === "/.well-known/t3/environment") return json(encodedDescriptor);
    if (url.pathname === "/api/auth/session") {
      return json({
        authenticated: true,
        auth,
        scopes: AuthStandardClientScopes,
        sessionMethod: "browser-session-cookie",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    // Snapshot endpoints fall back to the socket, which serves the same fixtures.
    if (/^\/(api|oauth|\.well-known)\//.test(url.pathname)) return json({}, 404);
    return realFetch(input, init);
  };
  return {
    [Symbol.dispose]: () => {
      globalThis.fetch = realFetch;
      threads = [];
      inboxFixture = undefined;
      teamsFixture = [];
      tasksFixture = [];
      taskSubscribers.clear();
      scratchOpened = false;
      teamSubscribers.clear();
      botsFixture = undefined;
      approvalsFixture = [];
      botsSubscriber = null;
      reviewSubscribers.clear();
      shellSubscribers.clear();
    },
  };
}

type ThreadEvent = Extract<OrchestrationV2ThreadStreamItem, { readonly kind: "event" }>["event"];

export async function emitTerminalMetadata(event: TerminalMetadataStreamEvent): Promise<void> {
  if (terminalMetadataSubscriber === null) throw new Error("No terminal metadata subscription");
  await Effect.runPromise(Queue.offer(terminalMetadataSubscriber, event));
}

/** Whether the app holds a live subscription to the thread, so events reach it. */
export function isThreadSubscribed(threadId: ThreadId): boolean {
  return threadSubscribers.has(threadId);
}

/** Delivers one domain event, such as a run or turn-item update, to the thread's subscription. */
export async function emitThreadEvent(
  threadId: ThreadId,
  event: Pick<ThreadEvent, "type" | "payload">,
): Promise<void> {
  const queue = threadSubscribers.get(threadId);
  if (!queue) throw new Error(`No live subscription for ${threadId}`);
  sequence += 1;
  await Effect.runPromise(
    Queue.offer(queue, {
      kind: "event",
      sequence,
      event: { ...event, id: EventId.make(`event-${sequence}`), threadId, occurredAt: AT },
    } as OrchestrationV2ThreadStreamItem),
  );
}

export function runningRun(threadId: ThreadId, id: string, ordinal: number, userMessageId: string) {
  return {
    ...run(threadId, RunId.make(id), ordinal, userMessageId),
    status: "running" as const,
    completedAt: null,
  };
}

export { userItem };

export async function emitVcsStatus(event: VcsStatusStreamEvent): Promise<void> {
  if (vcsStatusSubscriber === null) throw new Error("No VCS status subscription");
  await Effect.runPromise(Queue.offer(vcsStatusSubscriber, event));
}
