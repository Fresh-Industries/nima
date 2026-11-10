import { useStableCallback } from "../hooks/useStableCallback";
import { useEffect } from "react";
import { randomUUID } from "../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  BotId,
  type BotConfiguration,
  type BotProfile,
  type EnvironmentId,
  type ScheduledTaskId,
} from "@t3tools/contracts";
import { ArrowLeft, Bot, Settings, Search, Utensils, Code2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "../components/ui/dialog";
import { useEnvironment, useEnvironmentProviders } from "../state/environments";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import styles from "./nima.module.css";
import formStyles from "./BriefForm.module.css";
import { Routines } from "./Routines";
import { BotCapabilitiesSettings } from "./BotCapabilitiesSettings";
import { PersonalMemorySettings } from "./PersonalMemorySettings";
import { useBots, useOpenBotConversation } from "./useBots";

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Could not save this bot.";
};
export function Bots({
  environmentId: target,
  botId,
  taskId,
  view,
  settings,
  create: initialCreate,
}: {
  environmentId?: EnvironmentId;
  botId?: BotId;
  taskId?: ScheduledTaskId;
  view?: "routines";
  settings?: boolean;
  create?: boolean;
}) {
  const state = useBots(target);
  const create = useAtomCommand(serverEnvironment.createBot, { reportFailure: false });
  const canCreate = useAtomValue(serverEnvironment.createBot.permissionAtom(state.environmentId));
  const [creating, setCreating] = useState(initialCreate ?? false);
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loading = state.query.isPending && !state.query.data;
  const selected = state.bots.find((bot) => bot.id === botId);
  const openBot = useOpenBotConversation(state.environmentId);
  const canOpen = openBot.canOpen;
  const openConversation = async (bot: BotProfile) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const failure = await openBot.openConversation(bot);
    setBusy(false);
    if (failure) setError(failure);
  };
  if (taskId || view === "routines")
    return (
      <Routines
        {...(target ? { environmentId: target } : {})}
        {...(taskId ? { taskId } : {})}
        {...(botId ? { ownerBotId: botId } : {})}
      />
    );
  return (
    <main className={styles["nima-page"]}>
      <div className="mx-auto max-w-3xl space-y-7">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1>Bots</h1>
          </div>
          <Button
            size="sm"
            disabled={!canCreate || !state.connected}
            onClick={() => setCreating(true)}
          >
            Create a bot
          </Button>
        </header>
        <div className="flex gap-5 text-sm text-muted-foreground">
          <button
            className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setArchived(!archived)}
          >
            {archived ? "Active bots" : "Archived bots"}
          </button>
          <Link
            to="/bots"
            search={{
              ...(state.environmentId ? { environmentId: state.environmentId } : {}),
              view: "routines",
            }}
          >
            Existing routines →
          </Link>
        </div>
        {(error || state.query.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error || state.query.error}
          </p>
        )}
        {!state.connected && (
          <p role="status" className="text-sm text-muted-foreground">
            Connect to this Bara environment to open its bots.
          </p>
        )}
        {botId ? (
          <>
            <Link
              to="/bots"
              search={state.environmentId ? { environmentId: state.environmentId } : {}}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft size={15} />
              All bots
            </Link>
            {selected && !settings ? (
              <BotEntry
                key={selected.id}
                bot={selected}
                environmentId={state.environmentId!}
                connected={state.connected}
                canOpen={canOpen}
                onOpen={() => void openConversation(selected)}
              />
            ) : selected ? (
              <BotSettings
                key={`${state.environmentId}:${selected.id}`}
                bot={selected}
                environmentId={state.environmentId!}
                connected={state.connected}
                canOpen={canOpen}
                onOpen={() => void openConversation(selected)}
              />
            ) : (
              <p role="status">{loading ? "Loading bot…" : "This bot is unavailable."}</p>
            )}
          </>
        ) : (
          <section aria-label="Your bots" className="divide-y divide-border/60">
            {loading && (
              <p role="status" className="py-5 text-sm text-muted-foreground">
                Loading bots…
              </p>
            )}
            {state.bots
              .filter((bot) => !bot.home && bot.archived === archived)
              .map((bot) => (
                <div key={bot.id} className="flex items-center gap-4 py-5">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-xl"
                    aria-hidden="true"
                  >
                    {bot.config.avatar || <Bot size={21} strokeWidth={1.5} />}
                  </span>
                  <button
                    disabled={
                      busy || !state.connected || bot.archived || (!canOpen && !bot.threadId)
                    }
                    onClick={() => void openConversation(bot)}
                    className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
                  >
                    <h2 className="font-medium">{bot.config.name}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {bot.config.description}
                    </p>
                  </button>
                  <Link
                    to="/bots"
                    search={{
                      botId: bot.id,
                      settings: true,
                      ...(state.environmentId ? { environmentId: state.environmentId } : {}),
                    }}
                    aria-label={`Settings for ${bot.config.name}`}
                    className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <Settings size={16} />
                  </Link>
                </div>
              ))}
            {!loading && !state.bots.some((bot) => !bot.home && bot.archived === archived) && (
              <p className="py-10 text-sm text-muted-foreground">
                {archived ? "No archived bots." : "No bots yet"}
              </p>
            )}
          </section>
        )}
        {creating && (
          <CreateBot
            disabled={busy}
            onClose={() => setCreating(false)}
            onCreate={async (name, description, id) => {
              if (!state.environmentId) return "Connect to Bara first.";
              const result = await create({
                environmentId: state.environmentId,
                input: { id, name, description },
              });
              if (result._tag !== "Success") return failureMessage(result);
              setCreating(false);
              return null;
            }}
          />
        )}
      </div>
    </main>
  );
}
function CreateBot({
  onClose,
  onCreate,
  disabled,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string, id: BotId) => Promise<string | null>;
  disabled: boolean;
}) {
  const [id] = useState(() => BotId.make(randomUUID()));
  const [name, setName] = useState("New bot");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle className="sr-only">New bot</DialogTitle>
          <DialogDescription className="sr-only">Name and responsibility</DialogDescription>
          <input
            className={formStyles.name}
            aria-label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="New bot"
            disabled={busy}
          />
        </DialogHeader>
        <form
          className="min-h-0 overflow-y-auto"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            void onCreate(name.trim() || "New bot", description, id).then((message) => {
              setBusy(false);
              if (message) setError(message);
            });
          }}
        >
          <div className="px-6 pb-6">
            <div className="space-y-5">
              <textarea
                className={formStyles.brief}
                aria-label="Responsibility"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={600}
                required
                autoFocus
                disabled={busy}
                placeholder="What should this bot do?"
              />
              {!description.trim() && (
                <div className={formStyles.templates} aria-label="Bot starters">
                  {[
                    {
                      name: "Researcher",
                      label: "Research",
                      description: "Research questions and cite sources",
                      icon: Search,
                    },
                    {
                      name: "Chef",
                      label: "Cooking",
                      description: "Help me plan meals and cook",
                      icon: Utensils,
                    },
                    {
                      name: "Engineer",
                      label: "Code",
                      description: "Help me investigate and build software",
                      icon: Code2,
                    },
                  ].map(({ name: nextName, label, description: nextDescription, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setName(nextName);
                        setDescription(nextDescription);
                      }}
                    >
                      <Icon size={16} strokeWidth={1.5} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled || busy || !description.trim()}>
              {busy ? "Saving…" : "Create bot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
function BotSettings({
  bot,
  environmentId,
  connected,
  canOpen,
  onOpen,
}: {
  bot: BotProfile;
  environmentId: EnvironmentId;
  connected: boolean;
  canOpen: boolean;
  onOpen: () => void;
}) {
  const [draft, setDraft] = useState<BotConfiguration>(bot.config);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const supportsCapabilities =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.botCapabilities === true;
  const supportsToolAccess =
    useEnvironment(environmentId)?.serverConfig?.environment.capabilities.botToolAccess === true;
  const [base, setBase] = useState(bot.revision);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<BotProfile | null>(null);
  const canWrite = useAtomValue(serverEnvironment.writeBot.permissionAtom(environmentId));
  const write = useAtomCommand(serverEnvironment.writeBot, { reportFailure: false });
  const providers = useEnvironmentProviders().get(environmentId) ?? [];
  const options = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.instanceId}:${model.slug}`,
        selection: { instanceId: provider.instanceId, model: model.slug },
        label: `${provider.displayName ?? provider.driver} · ${model.slug}`,
      })),
    );
  const selectionKey = draft.modelSelection
    ? `${draft.modelSelection.instanceId}:${draft.modelSelection.model}`
    : "";
  const disabled = !connected || !canWrite || busy;
  const save = async (archive?: boolean) => {
    const archived = archive ?? bot.archived;
    setBusy(true);
    setStatus("");
    const result = await write({
      environmentId,
      input: { id: bot.id, config: draft, archived, expectedRevision: base },
    });
    setBusy(false);
    if (result._tag !== "Success") {
      setStatus(failureMessage(result));
      return;
    }
    if (result.value.status === "conflict") {
      setConflict(result.value.bot);
      setStatus(
        "Changed elsewhere. Your edits are kept. Load the saved settings before trying again.",
      );
      return;
    }
    setBase(result.value.bot.revision);
    setConflict(null);
    setStatus(archived ? "Archived. Conversations and active work are kept." : "Saved.");
  };
  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {bot.config.avatar} {bot.config.name}
        </h2>
        <Button
          size="sm"
          disabled={!connected || (!canOpen && !bot.threadId) || bot.archived}
          onClick={onOpen}
        >
          Open conversation
        </Button>
      </header>
      <Link
        to="/work"
        search={{ botId: bot.id, environmentId }}
        className="text-sm text-muted-foreground"
      >
        View work →
      </Link>
      <Link
        to="/bots"
        search={{ environmentId, botId: bot.id, view: "routines" }}
        className="ml-5 text-sm text-muted-foreground"
      >
        Routines →
      </Link>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid gap-2 text-sm">
          Name
          <Input
            disabled={disabled}
            value={draft.name}
            maxLength={80}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label className="grid gap-2 text-sm">
          Responsibility
          <Textarea
            disabled={disabled}
            value={draft.description}
            maxLength={600}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <details className="space-y-5">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Advanced settings
          </summary>
          <label className="grid gap-2 text-sm">
            Avatar
            <Input
              disabled={disabled}
              value={draft.avatar}
              maxLength={32}
              onChange={(event) => setDraft({ ...draft, avatar: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Instructions
            <Textarea
              disabled={disabled}
              value={draft.instructions}
              maxLength={4000}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Timezone
            <Input
              disabled={disabled}
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Preferred model for new conversations
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring"
              disabled={disabled}
              value={selectionKey}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  modelSelection:
                    options.find((option) => option.key === event.target.value)?.selection ?? null,
                })
              }
            >
              <option value="">Use environment default</option>
              {selectionKey && !options.some((option) => option.key === selectionKey) && (
                <option value={selectionKey}>{draft.modelSelection?.model} (unavailable)</option>
              )}
              {options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            Change the current conversation’s model and execution access in its composer.
          </p>
          {supportsToolAccess ? (
            <div className="space-y-2">
              <label className="grid gap-2 text-sm">
                Bara tool access
                <select
                  className="rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring"
                  disabled={disabled}
                  value={draft.toolAccess ?? "allowed"}
                  onChange={(event) => {
                    const toolAccess = event.target.value;
                    if (
                      toolAccess === "allowed" ||
                      toolAccess === "read-only" ||
                      toolAccess === "blocked"
                    )
                      setDraft({ ...draft, toolAccess });
                  }}
                >
                  <option value="allowed">Use existing permissions</option>
                  <option value="read-only">Read only</option>
                  <option value="blocked">Blocked</option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Applies to Bara tools in conversations, Work and routines. Delegated work inherits
                the stricter coordinator setting. Read only also prevents creating routines and
                starting or messaging other workers.
              </p>
              <p className="text-xs text-muted-foreground">
                Provider terminal, file access and separately configured integrations use the
                provider’s execution permissions. This setting does not sandbox them.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Update this host to configure Bara tool access for each Bot.
            </p>
          )}
          {supportsCapabilities && (
            <BotCapabilitiesSettings
              environmentId={environmentId}
              config={draft}
              disabled={disabled}
              onChange={(capabilities) => setDraft({ ...draft, capabilities })}
            />
          )}
        </details>
        {status && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}
        {conflict && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(conflict.config);
              setBase(conflict.revision);
              setConflict(null);
              setStatus("");
            }}
          >
            Load saved settings
          </Button>
        )}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={disabled || !draft.name.trim() || !draft.description.trim()}
          >
            Save settings
          </Button>
          {!bot.home && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => void save(!bot.archived)}
            >
              {bot.archived ? "Restore bot" : "Archive bot"}
            </Button>
          )}
        </div>
      </form>
      {supportsCapabilities && (
        <div className="space-y-4 border-t border-border pt-4">
          <Button
            variant="ghost"
            aria-expanded={memoryOpen}
            onClick={() => setMemoryOpen(!memoryOpen)}
          >
            Memory
          </Button>
          {memoryOpen && (
            <PersonalMemorySettings
              environmentId={environmentId}
              connected={connected}
              botId={bot.id}
            />
          )}
        </div>
      )}
    </article>
  );
}

function BotEntry({
  bot,
  environmentId,
  connected,
  canOpen,
  onOpen,
}: {
  bot: BotProfile;
  environmentId: EnvironmentId;
  connected: boolean;
  canOpen: boolean;
  onOpen: () => void;
}) {
  const open = useStableCallback(onOpen);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves a sidebar Bot link to its server-owned T3 conversation after the host connects
  useEffect(() => {
    if (connected && (canOpen || bot.threadId) && !bot.archived) open();
  }, [connected, canOpen, bot.threadId, bot.archived, open]);
  return (
    <div className="space-y-4">
      <p role="status">
        {bot.archived
          ? "Restore this bot to resume its conversation."
          : !canOpen && !bot.threadId
            ? "This connection needs permission to initialize the conversation."
            : "Opening conversation…"}
      </p>
      <Link
        to="/bots"
        search={{ botId: bot.id, environmentId, settings: true }}
        className="text-sm text-muted-foreground"
      >
        Bot settings →
      </Link>
    </div>
  );
}
