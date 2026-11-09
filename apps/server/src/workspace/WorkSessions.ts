import {
  CommandId,
  WorkSessionCreateInput,
  WorkSessionError,
  type WorkSessionCreated,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as BotStore from "../bots/BotStore.ts";
import { selectBotModel } from "../bots/botModelSelection.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const decodeCreate = Schema.decodeUnknownEffect(WorkSessionCreateInput);
const isWorkError = Schema.is(WorkSessionError);
export class WorkSessions extends Context.Service<
  WorkSessions,
  {
    readonly create: (
      input: WorkSessionCreateInput,
    ) => Effect.Effect<WorkSessionCreated, WorkSessionError>;
  }
>()("t3/workspace/WorkSessions") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const bots = yield* BotStore.BotStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const lock = yield* Semaphore.make(1);
  const create = Effect.fn("WorkSessions.create")(
    function* (raw: WorkSessionCreateInput) {
      const decoded = yield* decodeCreate(raw);
      const input = {
        ...decoded,
        title: decoded.title.trim(),
        objective: decoded.objective.trim(),
      };
      if (!input.title || !input.objective)
        return yield* new WorkSessionError({ reason: "unavailable" });
      const bot = input.coordinatorBotId === null ? null : yield* bots.get(input.coordinatorBotId);
      if (
        bot?.archived ||
        (input.projectId !== null &&
          bot?.config.capabilities?.toolPolicy.projectIds != null &&
          !bot.config.capabilities.toolPolicy.projectIds.includes(input.projectId))
      )
        return yield* new WorkSessionError({ reason: "unavailable" });
      const projectId =
        input.projectId ??
        (yield* folders.ensureScratchProject.pipe(
          Effect.mapError(
            (cause) =>
              new WorkSessionError({
                reason:
                  cause._tag === "ScratchUnavailableError" ? "workspace-unavailable" : "storage",
                cause,
              }),
          ),
        )).projectId;
      const project = yield* projects.getById(projectId);
      if (Option.isNone(project) || project.value.archivedAt !== null)
        return yield* new WorkSessionError({ reason: "unavailable" });
      const currentSettings = yield* settings.getSettings;
      const defaults = resolveProjectSettings(currentSettings, projectId, project.value).settings;
      const selection = selectBotModel({
        bot,
        projectId,
        defaults,
        providers: yield* registry.getProviders,
        settings: currentSettings,
        now: DateTime.toEpochMillis(yield* DateTime.now),
      });
      if (!selection) return yield* new WorkSessionError({ reason: "provider-unavailable" });
      const shell = yield* threads.getThreadShell(input.threadId);
      if (shell && shell.projectId !== projectId)
        return yield* new WorkSessionError({ reason: "changed" });
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [relationship] =
            yield* sql`SELECT bot_id FROM workspace_bots WHERE thread_id=${input.threadId}`;
          if (relationship) return yield* new WorkSessionError({ reason: "unavailable" });
          const [existing] = yield* sql<{
            kind: string;
            title: string;
            objective: string;
            scope_project_id: string | null;
            coordinator_bot_id: string | null;
            configuration_revision: number;
          }>`SELECT kind,title,objective,scope_project_id,coordinator_bot_id,configuration_revision FROM workspace_thread_metadata WHERE thread_id=${input.threadId}`;
          if (existing) {
            if (
              existing.kind !== "focus" ||
              existing.configuration_revision === 0 ||
              existing.title !== input.title ||
              existing.objective !== input.objective ||
              existing.scope_project_id !== input.projectId ||
              existing.coordinator_bot_id !== input.coordinatorBotId
            )
              return yield* new WorkSessionError({ reason: "changed" });
          } else {
            if (shell) return yield* new WorkSessionError({ reason: "changed" });
            // Reserve scoped configuration before the thread is visible or can accept its first turn.
            yield* sql`INSERT INTO workspace_thread_metadata(thread_id,kind,title,objective,updated_at,scope_project_id,coordinator_bot_id,configuration_revision) VALUES(${input.threadId},'focus',${input.title},${input.objective},${DateTime.formatIso(yield* DateTime.now)},${input.projectId},${input.coordinatorBotId},1)`;
          }
        }),
      );
      if (!shell)
        yield* launch.launch({
          commandId: CommandId.make(`bara-work:${input.threadId}`),
          threadId: input.threadId,
          projectId,
          title: input.title,
          modelSelection: selection,
          runtimeMode: defaults.defaultRuntimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "web",
        });
      return { threadId: input.threadId };
    },
    lock.withPermit,
    Effect.mapError((cause) =>
      isWorkError(cause) ? cause : new WorkSessionError({ reason: "storage", cause }),
    ),
  );
  return WorkSessions.of({ create });
});
export const layer = Layer.effect(WorkSessions, make);
