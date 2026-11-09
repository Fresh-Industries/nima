import {
  BotId,
  BotCapabilities,
  DEFAULT_BOT_CAPABILITIES,
  BotToolApproval,
  type BotApprovalResolveInput,
  BotAssistantCreateInput,
  BotAssistantUpdateInput,
  BotToolAccess,
  BotProfile,
  BotCreateInput,
  BotWriteInput,
  BotError,
  HOME_BOT_ID,
  PersonalAgentConfig,
  PersonalAgentWriteInput,
  PersonalAgentError,
  ThreadId,
  ModelSelection,
  type PersonalAgentProfile,
  type PersonalAgentWriteResult,
  type BotWriteResult,
  type BotsSnapshot,
  type WorkSessionContext,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

const configCodec = Schema.fromJsonString(PersonalAgentConfig);
const decodeConfig = Schema.decodeUnknownEffect(configCodec);
const encodeConfig = Schema.encodeEffect(configCodec);
const modelCodec = Schema.fromJsonString(ModelSelection);
const decodeModel = Schema.decodeUnknownEffect(modelCodec);
const encodeModel = Schema.encodeEffect(modelCodec);
const decodeCreate = Schema.decodeUnknownEffect(BotCreateInput);
const decodeWrite = Schema.decodeUnknownEffect(BotWriteInput);
const decodeProfileWrite = Schema.decodeUnknownEffect(PersonalAgentWriteInput);
const decodeAssistantCreate = Schema.decodeUnknownEffect(BotAssistantCreateInput);
const decodeAssistantUpdate = Schema.decodeUnknownEffect(BotAssistantUpdateInput);
const capabilitiesCodec = Schema.fromJsonString(BotCapabilities);
const decodeCapabilities = Schema.decodeUnknownEffect(capabilitiesCodec);
const encodeCapabilities = Schema.encodeEffect(capabilitiesCodec);
const decodeNames = Schema.decodeUnknownEffect(
  Schema.fromJsonString(BotToolApproval.fields.botNames),
);
const encodeNames = Schema.encodeSync(Schema.fromJsonString(BotToolApproval.fields.botNames));
const encodePolicy = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      profiles: Schema.Array(Schema.Struct({ id: BotId, revision: Schema.Int })),
      resource: Schema.String,
    }),
  ),
);
const isAgentError = Schema.is(PersonalAgentError);
const storageError = (cause: unknown) =>
  isAgentError(cause) ? cause : new PersonalAgentError({ reason: "storage", cause });
const invalid = (cause: unknown) => new PersonalAgentError({ reason: "invalid", cause });
const isBotError = Schema.is(BotError);
const botStorageError = (cause: unknown) =>
  isBotError(cause) ? cause : new BotError({ reason: "storage", cause });
type Row = {
  bot_id: string;
  description: string;
  config_json: string;
  model_selection_json: string | null;
  thread_id: string | null;
  revision: number;
  updated_at: string | null;
  archived: number;
  tool_access: BotToolAccess;
  capabilities_json: string;
};
type ApprovalRow = {
  id: string;
  thread_id: string;
  bot_names_json: string;
  tool: string;
  arguments_json: string;
  status: BotToolApproval["status"];
  revision: number;
  created_at: string;
  expires_at: string;
  policy_json: string;
};

export class BotStore extends Context.Service<
  BotStore,
  {
    readonly get: (id: BotId) => Effect.Effect<BotProfile, BotError>;
    readonly workForThread: (id: ThreadId) => Effect.Effect<WorkSessionContext | null, BotError>;
    readonly forThread: (id: ThreadId) => Effect.Effect<BotProfile | null, BotError>;
    readonly toolAccessForThread: (id: ThreadId) => Effect.Effect<BotToolAccess, BotError>;
    readonly policiesForThread: (
      id: ThreadId,
    ) => Effect.Effect<ReadonlyArray<BotProfile>, BotError>;
    readonly allowsResources: (
      threadId: ThreadId,
      environmentId: string,
      tool: string,
      args: unknown,
      profile: BotProfile,
    ) => Effect.Effect<boolean, BotError>;
    readonly approvalContext: (threadId: ThreadId) => Effect.Effect<string, BotError>;
    readonly approveToolCall: (input: {
      id: string;
      threadId: ThreadId;
      tool: string;
      arguments: string;
      profiles: ReadonlyArray<BotProfile>;
    }) => Effect.Effect<"pending" | "approved" | "rejected", BotError>;
    readonly resolveApproval: (
      input: BotApprovalResolveInput,
    ) => Effect.Effect<BotToolApproval, BotError>;
    readonly list: () => Effect.Effect<BotsSnapshot, BotError>;
    readonly create: (input: BotCreateInput) => Effect.Effect<BotProfile, BotError>;
    readonly createFromAssistant: (
      input: BotAssistantCreateInput,
      caller: ThreadId,
    ) => Effect.Effect<BotProfile, BotError>;
    readonly updateFromAssistant: (
      input: BotAssistantUpdateInput,
      caller: ThreadId,
    ) => Effect.Effect<BotWriteResult, BotError>;
    readonly write: (input: BotWriteInput) => Effect.Effect<BotWriteResult, BotError>;
    readonly markConversation: (id: BotId) => Effect.Effect<void, BotError>;
    readonly claimConversation: (id: BotId, legacy?: ThreadId) => Effect.Effect<ThreadId, BotError>;
    readonly readHome: () => Effect.Effect<PersonalAgentProfile, PersonalAgentError>;
    readonly writeHome: (
      input: PersonalAgentWriteInput,
    ) => Effect.Effect<PersonalAgentWriteResult, PersonalAgentError>;
    readonly subscribe: () => Stream.Stream<BotsSnapshot, BotError>;
    readonly subscribeHome: () => Stream.Stream<PersonalAgentProfile, PersonalAgentError>;
  }
>()("t3/bots/BotStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.sliding<void>(1);
  const fromRow = Effect.fn("BotStore.fromRow")(function* (
    row: Row,
  ): Effect.fn.Return<BotProfile, Schema.SchemaError> {
    const identity = yield* decodeConfig(row.config_json);
    return {
      id: BotId.make(row.bot_id),
      home: row.bot_id === HOME_BOT_ID,
      config: {
        name: identity.name,
        avatar: identity.avatar,
        instructions: identity.instructions,
        timezone: identity.timezone,
        reasoning: identity.reasoning,
        description: row.description,
        toolAccess: row.tool_access,
        capabilities: yield* decodeCapabilities(row.capabilities_json),
        modelSelection:
          row.model_selection_json === null ? null : yield* decodeModel(row.model_selection_json),
      },
      threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
      revision: row.revision,
      updatedAt: row.updated_at,
      archived: row.archived === 1,
    };
  });
  const get = Effect.fn("BotStore.get")(function* (id: BotId) {
    const [row] = yield* sql<Row>`SELECT * FROM workspace_bots WHERE bot_id=${id}`;
    if (!row) return yield* new BotError({ reason: "unavailable" });
    return yield* fromRow(row);
  }, Effect.mapError(botStorageError));
  const list = Effect.fn("BotStore.list")(function* () {
    const rows =
      yield* sql<Row>`SELECT * FROM workspace_bots ORDER BY (bot_id='primary') DESC, lower(json_extract(config_json,'$.name')),bot_id`;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`UPDATE workspace_bot_approvals SET status='invalidated',revision=revision+1 WHERE status IN ('pending','approved') AND EXISTS(SELECT 1 FROM json_each(policy_json,'$.profiles') principal LEFT JOIN workspace_bots bot ON bot.bot_id=json_extract(principal.value,'$.id') WHERE bot.bot_id IS NULL OR bot.revision<>json_extract(principal.value,'$.revision'))`;
    const approvals =
      yield* sql<ApprovalRow>`SELECT * FROM workspace_bot_approvals WHERE expires_at>${now} ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,created_at DESC LIMIT 100`;
    return {
      bots: yield* Effect.forEach(rows, fromRow),
      approvals: yield* Effect.forEach(approvals, approvalFromRow),
    };
  }, Effect.mapError(botStorageError));
  const forThread = Effect.fn("BotStore.forThread")(function* (id: ThreadId) {
    const [row] = yield* sql<Row>`SELECT * FROM workspace_bots WHERE thread_id=${id}`;
    return row ? yield* fromRow(row) : null;
  }, Effect.mapError(botStorageError));
  const workForThread = Effect.fn("BotStore.workForThread")(function* (id: ThreadId) {
    const [row] = yield* sql<{
      title: string;
      objective: string;
      scope_project_id: string | null;
      coordinator_bot_id: string | null;
      configuration_revision: number;
      coordinator_role: string | null;
    }>`SELECT (SELECT role FROM workspace_project_team_members member WHERE member.project_id=scope_project_id AND member.bot_id=coordinator_bot_id) AS coordinator_role,title,objective,scope_project_id,coordinator_bot_id,configuration_revision FROM workspace_thread_metadata WHERE thread_id=${id} AND kind='focus' AND configuration_revision>0`;
    if (!row) return null;
    return {
      title: row.title,
      objective: row.objective,
      projectId: row.scope_project_id === null ? null : ProjectId.make(row.scope_project_id),
      coordinator:
        row.coordinator_bot_id === null ? null : yield* get(BotId.make(row.coordinator_bot_id)),
      coordinatorRole: row.coordinator_role,
      revision: row.configuration_revision,
    };
  }, Effect.mapError(botStorageError));
  const policiesForThread = Effect.fn("BotStore.policiesForThread")(function* (id: ThreadId) {
    let current: string | null = id;
    const profiles = new Map<BotId, BotProfile>();
    const visited = new Set<string>();
    // Read current policies on every call. Native children and Bara-created Work both
    // inherit their ancestors' ceilings; switching providers or coordinators cannot widen them.
    while (current !== null) {
      if (visited.has(current) || visited.size >= 32)
        return yield* new BotError({ reason: "unavailable" });
      visited.add(current);
      const rows: ReadonlyArray<{
        bot_id: string | null;
        parent: string | null;
      }> = yield* sql<{
        bot_id: string | null;
        parent: string | null;
      }>`SELECT COALESCE(relationship.bot_id,coordinator.bot_id) AS bot_id,
        COALESCE(delegation.parent_thread_id,CASE WHEN json_extract(thread.payload_json,'$.lineage.relationshipToParent')='subagent' THEN json_extract(thread.payload_json,'$.lineage.parentThreadId') END) AS parent
        FROM (SELECT ${current} AS thread_id) caller
        LEFT JOIN workspace_bots relationship ON relationship.thread_id=caller.thread_id
        LEFT JOIN workspace_thread_metadata work ON work.thread_id=caller.thread_id AND (work.kind='assistant' OR (work.kind='focus' AND work.configuration_revision>0))
        LEFT JOIN workspace_bots coordinator ON coordinator.bot_id=work.coordinator_bot_id
        LEFT JOIN workspace_bot_delegations delegation ON delegation.thread_id=caller.thread_id
        LEFT JOIN orchestration_v2_projection_threads thread ON thread.thread_id=caller.thread_id`;
      const row = rows[0];
      if (!row) return yield* new BotError({ reason: "unavailable" });
      if (row.bot_id !== null) {
        const id = BotId.make(row.bot_id);
        if (!profiles.has(id)) profiles.set(id, yield* get(id));
      }
      current = row.parent;
    }
    return [...profiles.values()];
  }, Effect.mapError(botStorageError));
  const toolAccessForThread = Effect.fn("BotStore.toolAccessForThread")(function* (id: ThreadId) {
    const profiles = yield* policiesForThread(id);
    return profiles.some((p) => p.config.toolAccess === "blocked")
      ? "blocked"
      : profiles.some((p) => p.config.toolAccess === "read-only")
        ? "read-only"
        : "allowed";
  });
  const allowsResources = Effect.fn("BotStore.allowsResources")(function* (
    threadId: ThreadId,
    environmentId: string,
    tool: string,
    args: unknown,
    profile: BotProfile,
  ) {
    const allowed = profile.config.capabilities?.toolPolicy.projectIds;
    if (allowed == null) return true;
    if (
      ["t3_project_list", "t3_project_create", "t3_project_clone", "t3_environment_read"].includes(
        tool,
      )
    )
      return false;
    const projects = new Set<string>(),
      threads = new Set<string>();
    let valid = true,
      count = 0;
    const inspect = (value: unknown, depth = 0) => {
      if (++count > 256 || depth > 12) {
        valid = false;
        return;
      }
      if (Array.isArray(value)) {
        for (const child of value) inspect(child, depth + 1);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "allProjects" && child === true) valid = false;
        if (key === "environmentId" && typeof child === "string" && child !== environmentId)
          valid = false;
        if (/^(?:projectId|scopeProjectId)$/.test(key) && typeof child === "string")
          projects.add(child);
        if (/(?:^threadId$|ThreadId$)/.test(key) && typeof child === "string") threads.add(child);
        if (key === "threadIds" && Array.isArray(child))
          for (const id of child) if (typeof id === "string") threads.add(id);
        inspect(child, depth + 1);
      }
    };
    inspect(args);
    if (!valid) return false;
    const relationship = yield* forThread(threadId);
    const work = yield* workForThread(threadId);
    if (!relationship && work?.projectId !== null) threads.add(threadId);
    for (const id of threads) {
      if (id === threadId && (relationship || work?.projectId === null)) continue;
      const [row] = yield* sql<{
        project_id: string;
      }>`SELECT project_id FROM orchestration_v2_projection_threads WHERE thread_id=${id} AND deleted_at IS NULL`;
      if (!row) return false;
      projects.add(row.project_id);
    }
    return [...projects].every((id) => allowed.some((project) => project === id));
  }, Effect.mapError(botStorageError));
  const approvalFromRow = Effect.fn("BotStore.approvalFromRow")(function* (row: {
    id: string;
    thread_id: string;
    bot_names_json: string;
    tool: string;
    arguments_json: string;
    status: BotToolApproval["status"];
    revision: number;
    created_at: string;
    expires_at: string;
  }) {
    return {
      id: row.id,
      threadId: ThreadId.make(row.thread_id),
      botNames: yield* decodeNames(row.bot_names_json),
      tool: row.tool,
      arguments: row.arguments_json,
      status: row.status,
      revision: row.revision,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
  const approvalContext = Effect.fn("BotStore.approvalContext")(function* (threadId: ThreadId) {
    const [row] = yield* sql<{
      project_id: string | null;
      scope_project_id: string | null;
      configuration_revision: number | null;
    }>`SELECT thread.project_id,work.scope_project_id,work.configuration_revision FROM (SELECT ${threadId} AS id) caller LEFT JOIN orchestration_v2_projection_threads thread ON thread.thread_id=caller.id LEFT JOIN workspace_thread_metadata work ON work.thread_id=caller.id`;
    return `${row?.project_id ?? ""}:${row?.scope_project_id ?? ""}:${row?.configuration_revision ?? 0}`;
  }, Effect.mapError(botStorageError));
  const approveToolCall = Effect.fn("BotStore.approveToolCall")(
    function* (input: {
      id: string;
      threadId: ThreadId;
      tool: string;
      arguments: string;
      profiles: ReadonlyArray<BotProfile>;
    }) {
      const status = yield* sql.withTransaction(
        Effect.gen(function* () {
          const now = yield* DateTime.now;
          const at = DateTime.formatIso(now);
          const policy = encodePolicy({
            profiles: input.profiles.map((p) => ({ id: p.id, revision: p.revision })),
            resource: yield* approvalContext(input.threadId),
          });
          const [row] = yield* sql<{
            status: BotToolApproval["status"];
            expires_at: string;
            policy_json: string;
          }>`SELECT status,expires_at,policy_json FROM workspace_bot_approvals WHERE id=${input.id}`;
          if (row && row.expires_at > at && row.policy_json === policy) {
            if (row.status === "approved") {
              yield* sql`UPDATE workspace_bot_approvals SET status='consumed',revision=revision+1 WHERE id=${input.id}`;
              return "approved" as const;
            }
            if (row.status === "rejected") return "rejected" as const;
            if (row.status === "pending") return "pending" as const;
          }
          const [count] = yield* sql<{
            count: number;
          }>`SELECT COUNT(*) AS count FROM workspace_bot_approvals WHERE status='pending' AND expires_at>${at}`;
          if ((count?.count ?? 0) >= 256 || input.arguments.length > 16000)
            return yield* new BotError({ reason: "invalid" });
          yield* sql`INSERT INTO workspace_bot_approvals(id,thread_id,bot_names_json,policy_json,tool,arguments_json,status,created_at,expires_at)
        VALUES(${input.id},${input.threadId},${encodeNames(input.profiles.map((p) => p.config.name))},${policy},${input.tool},${input.arguments},'pending',${at},${DateTime.formatIso(DateTime.add(now, { hours: 24 }))})
        ON CONFLICT(id) DO UPDATE SET status='pending',policy_json=excluded.policy_json,revision=revision+1,created_at=excluded.created_at,expires_at=excluded.expires_at`;
          return "pending" as const;
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return status;
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const resolveApproval = Effect.fn("BotStore.resolveApproval")(
    function* (input: BotApprovalResolveInput) {
      const resolved = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<
            Parameters<typeof approvalFromRow>[0] & { policy_json: string }
          >`SELECT * FROM workspace_bot_approvals WHERE id=${input.id}`;
          if (
            !row ||
            row.status === "consumed" ||
            (input.decision === "approved" && row.status !== "pending") ||
            (input.decision === "pending" && row.status !== "rejected") ||
            row.revision !== input.expectedRevision ||
            row.expires_at <= DateTime.formatIso(yield* DateTime.now)
          )
            return yield* new BotError({ reason: "unavailable" });
          const profiles = yield* policiesForThread(ThreadId.make(row.thread_id));
          if (
            row.policy_json !==
            encodePolicy({
              profiles: profiles.map((p) => ({ id: p.id, revision: p.revision })),
              resource: yield* approvalContext(ThreadId.make(row.thread_id)),
            })
          ) {
            yield* sql`UPDATE workspace_bot_approvals SET status='invalidated',revision=revision+1 WHERE id=${input.id}`;
            return yield* approvalFromRow({
              ...row,
              status: "invalidated",
              revision: row.revision + 1,
            });
          }
          yield* sql`UPDATE workspace_bot_approvals SET status=${input.decision},revision=revision+1 WHERE id=${input.id}`;
          return yield* approvalFromRow({
            ...row,
            status: input.decision,
            revision: row.revision + 1,
          });
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return resolved;
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const readHome = Effect.fn("BotStore.readHome")(function* () {
    const [row] = yield* sql<{
      config_json: string;
      thread_id: string | null;
      revision: number;
      updated_at: string | null;
    }>`SELECT config_json,thread_id,revision,updated_at FROM workspace_bots WHERE bot_id='primary'`;
    if (!row) return yield* new PersonalAgentError({ reason: "unavailable" });
    return {
      id: "primary" as const,
      config: yield* decodeConfig(row.config_json),
      threadId: row.thread_id === null ? null : ThreadId.make(row.thread_id),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }, Effect.mapError(storageError));
  const writeHome = Effect.fn("BotStore.writeHome")(
    function* (raw: PersonalAgentWriteInput) {
      const input = yield* decodeProfileWrite(raw).pipe(Effect.mapError(invalid));
      yield* Effect.try(
        () => new Intl.DateTimeFormat("en-US", { timeZone: input.config.timezone }),
      ).pipe(Effect.mapError(invalid));
      if (!input.config.name.trim()) return yield* new PersonalAgentError({ reason: "invalid" });
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* readHome();
          if (current.revision !== input.expectedRevision)
            return { status: "conflict" as const, profile: current };
          for (const id of input.config.personalMemoryTaskIds) {
            const [exists] = yield* sql`SELECT task_id FROM scheduled_tasks WHERE task_id=${id}`;
            if (!exists) return yield* new PersonalAgentError({ reason: "unavailable" });
          }
          const config = {
            ...input.config,
            name: input.config.name.trim(),
            personalMemoryTaskIds: [...new Set(input.config.personalMemoryTaskIds)],
          };
          const encoded = yield* encodeConfig(config);
          yield* sql`UPDATE workspace_bots SET config_json=${encoded},revision=revision+1,updated_at=${DateTime.formatIso(yield* DateTime.now)} WHERE bot_id='primary'`;
          return { status: "saved" as const, profile: yield* readHome() };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError(storageError),
    Effect.uninterruptible,
  );
  const create = Effect.fn("BotStore.create")(
    function* (raw: BotCreateInput) {
      const input = yield* decodeCreate(raw).pipe(
        Effect.mapError((cause) => new BotError({ reason: "invalid", cause })),
      );
      if (
        !input.name.trim() ||
        !input.description.trim() ||
        input.id === HOME_BOT_ID ||
        !/^[a-zA-Z0-9_-]+$/.test(input.id)
      )
        return yield* new BotError({ reason: "invalid" });
      const config = {
        name: input.name.trim(),
        avatar: "",
        instructions: "",
        timezone: "UTC",
        reasoning: "xhigh" as const,
        personalMemoryTaskIds: [],
      };
      const encoded = yield* encodeConfig(config);
      // Client-generated identity makes reconnect/retry safe without creating duplicate teammates.
      yield* sql`INSERT INTO workspace_bots(bot_id,description,config_json,updated_at) VALUES(${input.id},${input.description.trim()},${encoded},${DateTime.formatIso(yield* DateTime.now)}) ON CONFLICT(bot_id) DO NOTHING`;
      yield* PubSub.publish(changes, undefined);
      return yield* get(input.id);
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const write = Effect.fn("BotStore.write")(
    function* (raw: BotWriteInput) {
      const input = yield* decodeWrite(raw).pipe(
        Effect.mapError((cause) => new BotError({ reason: "invalid", cause })),
      );
      if (
        !input.config.name.trim() ||
        !input.config.description.trim() ||
        (input.id === HOME_BOT_ID && input.archived)
      )
        return yield* new BotError({ reason: "invalid" });
      yield* Effect.try(
        () => new Intl.DateTimeFormat("en-US", { timeZone: input.config.timezone }),
      ).pipe(Effect.mapError((cause) => new BotError({ reason: "invalid", cause })));
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* get(input.id);
          if (current.revision !== input.expectedRevision)
            return { status: "conflict" as const, bot: current };
          const [row] = yield* sql<{
            config_json: string;
          }>`SELECT config_json FROM workspace_bots WHERE bot_id=${input.id}`;
          if (!row) return yield* new BotError({ reason: "unavailable" });
          const old = yield* decodeConfig(row.config_json);
          const capabilities = input.config.capabilities ?? current.config.capabilities;
          if (capabilities) {
            if (
              new Set(capabilities.toolPolicy.rules.map((rule) => rule.group)).size !==
              capabilities.toolPolicy.rules.length
            )
              return yield* new BotError({ reason: "invalid" });
            for (const id of capabilities.skillPageIds) {
              const [page] =
                yield* sql`SELECT id FROM workspace_pages WHERE id=${id} AND archived=0`;
              if (!page && !current.config.capabilities?.skillPageIds.includes(id))
                return yield* new BotError({ reason: "unavailable" });
            }
            for (const id of capabilities.toolPolicy.projectIds ?? []) {
              const [project] =
                yield* sql`SELECT project_id FROM projection_projects WHERE project_id=${id} AND deleted_at IS NULL`;
              if (!project) return yield* new BotError({ reason: "unavailable" });
            }
          }
          const identity = {
            ...old,
            name: input.config.name.trim(),
            avatar: input.config.avatar,
            instructions: input.config.instructions,
            timezone: input.config.timezone,
            reasoning: input.config.reasoning,
          };
          yield* sql`UPDATE workspace_bots SET description=${input.config.description.trim()},config_json=${yield* encodeConfig(identity)},model_selection_json=${input.config.modelSelection === null ? null : yield* encodeModel(input.config.modelSelection)},tool_access=${input.config.toolAccess ?? current.config.toolAccess ?? "allowed"},capabilities_json=${yield* encodeCapabilities(capabilities!)},archived=${input.archived ? 1 : 0},revision=revision+1,updated_at=${DateTime.formatIso(yield* DateTime.now)} WHERE bot_id=${input.id}`;
          return { status: "saved" as const, bot: yield* get(input.id) };
        }),
      );
      if (result.status === "saved") yield* PubSub.publish(changes, undefined);
      return result;
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const createFromAssistant = Effect.fn("BotStore.createFromAssistant")(
    function* (raw: BotAssistantCreateInput, caller: ThreadId) {
      const input = yield* decodeAssistantCreate(raw).pipe(
        Effect.mapError(() => new BotError({ reason: "invalid" })),
      );
      const principal = yield* forThread(caller);
      if (!principal?.home || principal.archived)
        return yield* new BotError({ reason: "unavailable" });
      if (
        input.id === HOME_BOT_ID ||
        !/^[a-zA-Z0-9_-]+$/.test(input.id) ||
        !input.name.trim() ||
        !input.description.trim()
      )
        return yield* new BotError({ reason: "invalid" });
      const bot = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [existing] = yield* sql`SELECT bot_id FROM workspace_bots WHERE bot_id=${input.id}`;
          if (existing) {
            const current = yield* get(input.id);
            if (
              current.config.name !== input.name.trim() ||
              current.config.description !== input.description.trim()
            )
              return yield* new BotError({ reason: "invalid" });
            return current;
          }
          const identity = {
            name: input.name.trim(),
            avatar: input.avatar ?? "",
            instructions: input.instructions ?? "",
            timezone: principal.config.timezone,
            reasoning: principal.config.reasoning,
            personalMemoryTaskIds: [],
          };
          yield* sql`INSERT INTO workspace_bots(bot_id,description,config_json,tool_access,capabilities_json,updated_at) VALUES(${input.id},${input.description.trim()},${yield* encodeConfig(identity)},'read-only',${yield* encodeCapabilities({ ...DEFAULT_BOT_CAPABILITIES, toolPolicy: principal.config.capabilities?.toolPolicy ?? DEFAULT_BOT_CAPABILITIES.toolPolicy })},${DateTime.formatIso(yield* DateTime.now)})`;
          return yield* get(input.id);
        }),
      );
      yield* PubSub.publish(changes, undefined);
      return bot;
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const updateFromAssistant = Effect.fn("BotStore.updateFromAssistant")(function* (
    raw: BotAssistantUpdateInput,
    caller: ThreadId,
  ) {
    const input = yield* decodeAssistantUpdate(raw).pipe(
      Effect.mapError(() => new BotError({ reason: "invalid" })),
    );
    const principal = yield* forThread(caller);
    if (!principal || principal.archived || (!principal.home && principal.id !== input.id))
      return yield* new BotError({ reason: "unavailable" });
    const bot = yield* get(input.id);
    const instructions = input.appendInstructions
      ? `${input.instructions ?? bot.config.instructions}\n\n${input.appendInstructions}`.trim()
      : (input.instructions ?? bot.config.instructions);
    return yield* write({
      id: bot.id,
      expectedRevision: input.expectedRevision,
      archived: bot.archived,
      config: {
        ...bot.config,
        name: input.name ?? bot.config.name,
        description: input.description ?? bot.config.description,
        avatar: input.avatar ?? bot.config.avatar,
        instructions,
        modelSelection:
          input.modelSelection === undefined ? bot.config.modelSelection : input.modelSelection,
      },
    });
  }, Effect.mapError(botStorageError));
  const claimConversation = Effect.fn("BotStore.claimConversation")(
    function* (id: BotId, legacy?: ThreadId) {
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const current = yield* get(id);
          if (current.archived) return yield* new BotError({ reason: "unavailable" });
          if (current.threadId) {
            const [row] = yield* sql<{
              deleted_at: string | null;
            }>`SELECT deleted_at FROM orchestration_v2_projection_threads WHERE thread_id=${current.threadId}`;
            if (!row || row.deleted_at === null) return { id: current.threadId, changed: false };
          }
          let chosen: ThreadId | undefined;
          if (id === HOME_BOT_ID && !current.threadId && legacy) {
            const [exists] =
              yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE thread_id=${legacy} AND deleted_at IS NULL AND archived_at IS NULL AND json_extract(payload_json,'$.linkOrigin') IS NULL`;
            if (exists) chosen = legacy;
          }
          const [row] = yield* sql<{
            generation: number;
          }>`SELECT generation FROM workspace_bots WHERE bot_id=${id}`;
          const generation = (row?.generation ?? 0) + 1;
          const canonical =
            chosen ??
            ThreadId.make(
              id === HOME_BOT_ID
                ? `bara-personal-assistant-${generation}`
                : `bara-bot-${id}-${generation}`,
            );
          yield* sql`UPDATE workspace_bots SET thread_id=${canonical},generation=${generation},revision=revision+1,updated_at=${DateTime.formatIso(yield* DateTime.now)} WHERE bot_id=${id}`;
          return { id: canonical, changed: true };
        }),
      );
      if (result.changed) yield* PubSub.publish(changes, undefined);
      return result.id;
    },
    Effect.mapError(botStorageError),
    Effect.uninterruptible,
  );
  const markConversation = Effect.fn("BotStore.markConversation")(function* (id: BotId) {
    const bot = yield* get(id);
    if (!bot.threadId) return;
    yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,coordinator_bot_id) VALUES(${bot.threadId},'assistant','','',${DateTime.formatIso(yield* DateTime.now)},${id}) ON CONFLICT(thread_id) DO UPDATE SET kind='assistant',coordinator_bot_id=${id}`;
  }, Effect.mapError(botStorageError));
  const live = <A, E>(load: () => Effect.Effect<A, E>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(load()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(load)),
        );
      }),
    );
  return BotStore.of({
    get,
    list,
    forThread,
    toolAccessForThread,
    policiesForThread,
    allowsResources,
    approveToolCall,
    approvalContext,
    resolveApproval,
    workForThread,
    create,
    createFromAssistant,
    updateFromAssistant,
    write,
    claimConversation,
    markConversation,
    readHome,
    writeHome,
    subscribe: () => live(list),
    subscribeHome: () => live(readHome),
  });
});
export const layer = Layer.effect(BotStore, make);
