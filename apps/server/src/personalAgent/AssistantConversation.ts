import { selectBotModel } from "../bots/botModelSelection.ts";
import * as BotStore from "../bots/BotStore.ts";
import { BotId, BotError, HOME_BOT_ID, type BotProfile } from "@t3tools/contracts";
import {
  CommandId,
  PersonalAgentError,
  type PersonalAgentOpenInput,
  type PersonalAgentProfile,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PersonalAgent from "./PersonalAgent.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

export class AssistantConversation extends Context.Service<
  AssistantConversation,
  {
    readonly openBot: (input: { readonly id: BotId }) => Effect.Effect<BotProfile, BotError>;
    readonly open: (
      input: PersonalAgentOpenInput,
    ) => Effect.Effect<PersonalAgentProfile, PersonalAgentError>;
  }
>()("t3/personalAgent/AssistantConversation") {}
const make = Effect.gen(function* () {
  const agent = yield* PersonalAgent.PersonalAgent;
  const bots = yield* BotStore.BotStore;
  const launch = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const lock = yield* Semaphore.make(1);
  const openBot = Effect.fn("AssistantConversation.openBot")(
    function* (input: {
      readonly id: BotId;
      readonly legacyThreadId?: PersonalAgentOpenInput["legacyThreadId"];
    }) {
      const profile = yield* bots.get(input.id);
      const threadId = yield* bots.claimConversation(input.id, input.legacyThreadId);
      const shell = yield* threads.getThreadShell(threadId);
      if (shell?.archivedAt)
        yield* threads.dispatch({
          type: "thread.unarchive",
          commandId: CommandId.make(
            `personal-assistant:reopen:${threadId}:${DateTime.formatIso(shell.archivedAt)}`,
          ),
          threadId,
        });
      if (!shell) {
        const { projectId } = yield* folders.ensureScratchProject.pipe(
          Effect.mapError(
            (cause) =>
              new BotError({
                reason:
                  cause._tag === "ScratchUnavailableError" ? "workspace-unavailable" : "storage",
                cause,
              }),
          ),
        );
        const project = yield* projects.getById(projectId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new PersonalAgentError({ reason: "unavailable" })),
              onSome: Effect.succeed,
            }),
          ),
        );
        const currentSettings = yield* settings.getSettings;
        const defaults = resolveProjectSettings(currentSettings, projectId, project).settings;
        const providers = yield* registry.getProviders;
        const selection = selectBotModel({
          bot: profile,
          projectId,
          defaults,
          providers,
          settings: currentSettings,
          now: DateTime.toEpochMillis(yield* DateTime.now),
        });
        if (!selection) return yield* new BotError({ reason: "provider-unavailable" });
        yield* launch.launch({
          commandId: CommandId.make(`personal-assistant:${threadId}`),
          threadId,
          projectId,
          title: profile.config.name,
          modelSelection: selection,
          runtimeMode: defaults.defaultRuntimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "web",
        });
      }
      yield* bots.markConversation(input.id);
      return yield* bots.get(input.id);
    },
    lock.withPermit,
    Effect.mapError((cause) =>
      isBotError(cause) ? cause : new BotError({ reason: "storage", cause }),
    ),
  );
  const open = Effect.fn("AssistantConversation.open")(
    function* (input: PersonalAgentOpenInput) {
      const previous = yield* agent.read();
      if (previous.revision === 0 && input.legacyConfig)
        yield* agent.write({ config: input.legacyConfig, expectedRevision: 0 });
      yield* openBot({
        id: HOME_BOT_ID,
        ...(input.legacyThreadId ? { legacyThreadId: input.legacyThreadId } : {}),
      });
      return yield* agent.read();
    },
    Effect.mapError((cause) =>
      isAgentError(cause)
        ? cause
        : new PersonalAgentError({
            reason:
              isBotError(cause) && cause.reason === "provider-unavailable"
                ? "provider-unavailable"
                : "storage",
            cause,
          }),
    ),
  );
  return AssistantConversation.of({ open, openBot });
});
export const layer = Layer.effect(AssistantConversation, make);
const isAgentError = Schema.is(PersonalAgentError);

const isBotError = Schema.is(BotError);
