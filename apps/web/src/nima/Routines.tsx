import {
  scheduleLabel,
  ScheduledRelativeLabel,
} from "../components/settings/scheduledTaskPresentation";
import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  BotId,
  EnvironmentId,
  ProjectId,
  ScheduledTask,
  ScheduledTaskId,
  ScheduledTaskRunCursor,
} from "@t3tools/contracts";
import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  Clock3,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ChatMarkdown from "../components/ChatMarkdown";
import { runtimeModeConfig } from "../components/chat/runtimeModeConfig";
import {
  ScheduledTaskEditorDialog,
  WebhookDeliveriesDialog,
} from "../components/settings/ScheduledTasksSettings";
import { SettingsScopeProvider } from "../components/settings/SettingsScopeContext";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { requestConfirmDialog } from "../confirmDialog";
import { useScratchProject } from "../hooks/useScratchProject";
import { useStableCallback } from "../hooks/useStableCallback";
import { environmentIdsKey } from "../state/environmentAtomList";
import { useEnvironment, usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { scheduledTaskCreatePermissionsAtom, useScheduledBots } from "../state/scheduledTasks";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { useConversationHandoffStore } from "./conversationHandoffStore";
import { useBots } from "./useBots";
import styles from "./nima.module.css";
import { BOT_CREATION_PROMPT } from "./botConversation";

type BotTarget = { environmentId?: EnvironmentId; taskId?: ScheduledTaskId; ownerBotId?: BotId };
type Editor = {
  environmentId: EnvironmentId;
  task: ScheduledTask | null;
  defaultProjectId?: ProjectId;
};

export function Routines(target: BotTarget) {
  const {
    bots: allRoutines,
    loading,
    errors,
    connected,
    environments,
    connectedEnvironments,
  } = useScheduledBots();
  const navigate = useNavigate();
  const primary = usePrimaryEnvironmentId();
  const scratch = useScratchProject();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const permissions = useAtomValue(
    scheduledTaskCreatePermissionsAtom(
      environmentIdsKey(connectedEnvironments.map((entry) => entry.environmentId)),
    ),
  );
  const permitted = connectedEnvironments.filter((_, index) => permissions[index]);
  const creationEnvironment = target.environmentId
    ? permitted.find((entry) => entry.environmentId === target.environmentId)
    : (permitted.find((entry) => entry.environmentId === primary) ?? permitted[0]);
  const bots = allRoutines.filter(
    (entry) =>
      (!target.environmentId || entry.environmentId === target.environmentId) &&
      (!target.ownerBotId || entry.task.ownerBotId === target.ownerBotId),
  );
  const directory = useBots(
    creationEnvironment?.environmentId ?? target.environmentId ?? primary ?? undefined,
  );
  const owner = target.ownerBotId
    ? directory.bots.find((bot) => bot.id === target.ownerBotId)
    : undefined;
  const defaultOwner = target.ownerBotId
    ? owner
    : directory.bots.find((bot) => bot.home && !bot.archived);
  const canCreateRoutine = Boolean(
    creationEnvironment?.serverConfig?.environment.capabilities.botRoutines &&
    defaultOwner &&
    !defaultOwner.archived &&
    directory.connected,
  );
  const selectedEnvironmentId =
    target.environmentId ?? primary ?? connectedEnvironments[0]?.environmentId;
  const selected = target.taskId
    ? bots.find(
        ({ environmentId, task }) =>
          task.id === target.taskId && environmentId === selectedEnvironmentId,
      )
    : undefined;
  const selectedEnvironment = environments.find(
    (entry) => entry.environmentId === selectedEnvironmentId,
  );
  const open = (environmentId: EnvironmentId, taskId: ScheduledTaskId) =>
    void navigate({
      to: "/bots",
      search: {
        environmentId,
        taskId,
        ...(target.ownerBotId ? { botId: target.ownerBotId, view: "routines" } : {}),
      },
    });
  const describe = async () => {
    if (!creationEnvironment || !canCreateRoutine || creationEnvironment.environmentId !== primary)
      return;
    const prompt = defaultOwner
      ? `Create a routine for my existing ${defaultOwner.config.name} Bot (ownerBotId: ${defaultOwner.id}) on this Bara host. ${BOT_CREATION_PROMPT}`
      : BOT_CREATION_PROMPT;
    useConversationHandoffStore.getState().begin(prompt);
    await navigate({ to: "/" }).catch(() => {
      const current = useConversationHandoffStore.getState().request;
      if (current?.prompt === prompt) useConversationHandoffStore.getState().dismiss(current.id);
      toastManager.add(
        stackedThreadToast({ type: "error", title: "Could not open your assistant" }),
      );
    });
  };
  const create = async () => {
    if (!creationEnvironment || !canCreateRoutine || preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    const environmentId = creationEnvironment.environmentId;
    const project = await scratch.openScratchProject(
      environmentId,
      "Could not prepare the routine’s workspace",
    );
    preparingRef.current = false;
    setPreparing(false);
    if (project) setEditor({ environmentId, task: null, defaultProjectId: project.id });
    else
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "A workspace is needed",
          description: "Connect a workspace on this host before creating a bot.",
        }),
      );
  };
  return (
    <main className={styles["nima-page"]}>
      <div className="mx-auto max-w-3xl space-y-8">
        <Link
          to={owner?.home ? "/settings/general" : "/bots"}
          hash={owner?.home ? "personal-agent" : ""}
          search={
            owner && !owner.home && directory.environmentId
              ? { environmentId: directory.environmentId, botId: owner.id, settings: true }
              : {}
          }
          className="text-sm text-muted-foreground"
        >
          {owner ? `← ${owner.config.name}` : "← Bots"}
        </Link>
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1>{owner ? `${owner.config.name} · Routines` : "Routines"}</h1>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              disabled={!canCreateRoutine || creationEnvironment?.environmentId !== primary}
              onClick={() => void describe()}
            >
              Create a routine
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canCreateRoutine || preparing}
              onClick={() => void create()}
            >
              <Plus size={15} />
              {preparing ? "Preparing…" : "Set up manually"}
            </Button>
          </div>
        </header>
        {errors.map((error) => (
          <p key={error} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ))}
        {!connected && (
          <p role="status" className="text-sm text-muted-foreground">
            Connect to Bara to manage your bots.
          </p>
        )}
        {connected && !creationEnvironment && (
          <p className="text-sm text-muted-foreground">
            This connection can view bots. Creating or changing one needs permission to operate
            agents.
          </p>
        )}
        {target.taskId ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigate({
                  to: "/bots",
                  search: {
                    view: "routines",
                    ...(target.environmentId ? { environmentId: target.environmentId } : {}),
                    ...(target.ownerBotId ? { botId: target.ownerBotId } : {}),
                  },
                })
              }
            >
              <ArrowLeft size={15} />
              All routines
            </Button>
            {selected ? (
              <BotDetails
                key={`${selected.environmentId}:${selected.task.id}`}
                {...selected}
                onEdit={() => setEditor(selected)}
                onDeleted={() =>
                  void navigate({
                    to: "/bots",
                    search: {
                      view: "routines",
                      ...(target.ownerBotId ? { botId: target.ownerBotId } : {}),
                      ...(target.environmentId ? { environmentId: target.environmentId } : {}),
                    },
                  })
                }
              />
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {loading
                  ? "Loading bot…"
                  : selectedEnvironment?.connection.phase !== "connected"
                    ? "Reconnect this bot’s host to open it."
                    : "This bot is no longer available."}
              </p>
            )}
          </>
        ) : (
          <section aria-label="Your routines" className="divide-y divide-border/60">
            {loading && (
              <p role="status" className="py-6 text-sm text-muted-foreground">
                Loading routines…
              </p>
            )}
            {bots.map(({ environmentId, task }) => (
              <div key={`${environmentId}:${task.id}`} className="flex items-start gap-3 py-5">
                <Bot size={20} strokeWidth={1.5} className="mt-1 shrink-0 text-muted-foreground" />
                <button
                  onClick={() => open(environmentId, task.id)}
                  className="min-w-0 flex-1 space-y-1.5 text-left rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <h2 className="break-words text-base font-medium">{task.title}</h2>
                  <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                    {task.prompt}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <BotSchedule task={task} />
                    {environments.length > 1
                      ? ` · ${environments.find((entry) => entry.environmentId === environmentId)?.label ?? "Host unavailable"}`
                      : ""}
                  </p>
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Open ${task.title}`}
                  onClick={() => open(environmentId, task.id)}
                >
                  <ArrowUpRight size={16} />
                </Button>
              </div>
            ))}
            {!bots.length && !loading && (
              <div className="space-y-3 py-14 text-center">
                <Bot size={28} strokeWidth={1.3} className="mx-auto text-muted-foreground" />
                <h2 className="text-lg font-medium">No routines</h2>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  Choose what a bot should do and when. Its work stays in real conversations you can
                  open and continue.
                </p>
              </div>
            )}
          </section>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Scheduled runs continue when this window closes. Keep their host online for automatic
          work.
        </p>
      </div>
      {editor && (
        <SettingsScopeProvider search={{}} onChange={() => {}}>
          <ScheduledTaskEditorDialog
            key={`${editor.environmentId}:${editor.task?.id ?? "new"}`}
            task={editor.task}
            {...(editor.defaultProjectId ? { defaultProjectId: editor.defaultProjectId } : {})}
            initialEnvironmentId={editor.environmentId}
            presentation="bot"
            {...(!editor.task && defaultOwner ? { defaultOwnerBot: defaultOwner } : {})}
            onClose={() => setEditor(null)}
            onSaved={(environmentId, task) => open(environmentId, task.id)}
          />
        </SettingsScopeProvider>
      )}
    </main>
  );
}

function BotSchedule({ task }: { task: ScheduledTask }) {
  return (
    <>
      {scheduleLabel(task.schedule)} ·{" "}
      {task.blockedByPolicy ? (
        task.blockedByPolicy
      ) : !task.enabled ? (
        "Paused"
      ) : task.lastRunStatus === "running" ? (
        "Working"
      ) : task.schedule.type === "webhook" ? (
        "Listening"
      ) : task.nextRunAt ? (
        <>
          Next <ScheduledRelativeLabel value={task.nextRunAt} />
        </>
      ) : (
        "Not scheduled"
      )}
    </>
  );
}

function BotDetails({
  environmentId,
  task,
  onEdit,
  onDeleted,
}: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const directory = useBots(environmentId);
  const owningBot = directory.bots.find((bot) => bot.id === task.ownerBotId);
  const pending = useRef(false);
  const [deliveries, setDeliveries] = useState(false);
  const environment = useEnvironment(environmentId);
  const connected =
    environment?.connection.phase === "connected" && environment.serverConfig !== null;
  const goalQuery = useEnvironmentQuery(
    task.goalId && connected
      ? serverEnvironment.workspaceGoalsLive({ environmentId, input: {} })
      : null,
  );
  const linkedGoal = goalQuery.data?.goals.find((goal) => goal.id === task.goalId);
  const goalWaiting = Boolean(
    task.goalId && goalQuery.data && linkedGoal?.content.status !== "active",
  );
  const canEdit = useAtomValue(serverEnvironment.upsertScheduledTask.permissionAtom(environmentId));
  const canToggle = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const canDelete = useAtomValue(
    serverEnvironment.deleteScheduledTask.permissionAtom(environmentId),
  );
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "bot pause or resume",
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, { label: "bot run now" });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { label: "bot delete" });
  const act = async (action: "toggle" | "run" | "delete") => {
    if (pending.current || !connected) return;
    if (
      (action === "toggle" && !canToggle) ||
      (action === "run" && !canRun) ||
      (action === "delete" && !canDelete)
    )
      return;
    pending.current = true;
    setBusy(true);
    if (
      action === "delete" &&
      !(await requestConfirmDialog(
        `Delete “${task.title}” and its schedule? Existing conversations and running work are kept.`,
        { variant: "destructive" },
      ))
    ) {
      pending.current = false;
      setBusy(false);
      return;
    }
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input: { id: task.id } })
          : await remove({ environmentId, input: { id: task.id } });
    pending.current = false;
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update bot",
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    if (result._tag === "Success" && action === "delete") onDeleted();
  };
  return (
    <article className="space-y-8">
      <header className="space-y-4">
        <div className="space-y-2">
          <h2 className="break-words text-xl font-medium">{task.title}</h2>
          {owningBot && (
            <Link
              to={owningBot.home ? "/" : "/bots"}
              search={owningBot.home ? {} : { environmentId, botId: owningBot.id }}
              className="text-sm text-muted-foreground"
            >
              {owningBot.config.avatar} {owningBot.config.name}
              {owningBot.archived ? " · archived" : ""}
            </Link>
          )}
          {goalWaiting && (
            <p className="text-sm text-muted-foreground">
              Waiting for this goal to resume. No check-ins will launch while it is inactive.
            </p>
          )}
          {task.goalId && (
            <Link
              to="/goals"
              search={{ goalId: task.goalId, environmentId }}
              className="text-sm text-muted-foreground hover:underline"
            >
              View linked goal →
            </Link>
          )}
          <p className="text-sm text-muted-foreground">
            <BotSchedule task={task} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.schedule.type !== "webhook" && (
            <Button
              size="sm"
              disabled={
                busy ||
                !canRun ||
                !connected ||
                task.lastRunStatus === "running" ||
                task.blockedByPolicy !== undefined
              }
              onClick={() => void act("run")}
            >
              <Play size={14} />
              Run now
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canToggle || !connected}
            onClick={() => void act("toggle")}
          >
            {task.enabled ? <Pause size={14} /> : <Play size={14} />}
            {task.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !canEdit || !connected}
            onClick={onEdit}
          >
            <Pencil size={14} />
            Edit
          </Button>
          <Menu>
            <MenuTrigger
              aria-label="Bot actions"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <MoreHorizontal size={17} />
            </MenuTrigger>
            <MenuPopup align="end">
              {task.schedule.type === "webhook" && (
                <MenuItem disabled={!canEdit} onClick={() => setDeliveries(true)}>
                  Webhook deliveries
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                disabled={busy || !canDelete || !connected}
                onClick={() => void act("delete")}
              >
                <Trash2 size={14} />
                Delete bot
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        {task.blockedByPolicy && (
          <p role="status" className="text-sm text-destructive">
            {task.blockedByPolicy}
          </p>
        )}
        {task.lastRunError && (
          <p role="status" className="break-words text-sm text-destructive">
            {task.lastRunError}
          </p>
        )}
      </header>
      <section className="space-y-3" aria-label="Bot instructions">
        <h3 className="text-sm font-medium">Instructions</h3>
        <ChatMarkdown text={task.prompt} cwd={undefined} parseRawHtml={false} />
      </section>
      <dl className="grid grid-cols-1 gap-5 border-y border-border/60 py-5 text-sm sm:grid-cols-3">
        <div className="space-y-1">
          <dt className="text-muted-foreground">Model</dt>
          <dd className="break-words">{task.modelSelection.model}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Access</dt>
          <dd>
            {runtimeModeConfig[task.runtimeMode].label}
            {task.interactionMode === "plan" ? " · Plan mode" : ""}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Runs</dt>
          <dd>
            {task.runCount}
            {task.lastRunStatus === "running" ? " · Starting now" : ""}
          </dd>
        </div>
      </dl>
      {task.threadId && (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId: task.threadId }}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open destination conversation
          <ArrowUpRight size={14} />
        </Link>
      )}
      <BotRuns environmentId={environmentId} task={task} connected={connected} />
      {deliveries && (
        <WebhookDeliveriesDialog
          environmentId={environmentId}
          task={task}
          onClose={() => setDeliveries(false)}
        />
      )}
    </article>
  );
}

function BotRuns({
  environmentId,
  task,
  connected,
}: {
  environmentId: EnvironmentId;
  task: ScheduledTask;
  connected: boolean;
}) {
  const [before, setBefore] = useState<ScheduledTaskRunCursor | undefined>();
  const query = useEnvironmentQuery(
    connected
      ? serverEnvironment.scheduledTaskRuns({
          environmentId,
          input: { id: task.id, ...(before ? { before } : {}) },
        })
      : null,
  );
  const refresh = useStableCallback(query.refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- updates the visible persisted run history when the scheduler publishes a lifecycle change
  useEffect(() => {
    if (connected && task.lastRunAt !== null && task.lastRunStatus !== "never") refresh();
  }, [connected, task.lastRunAt, task.lastRunStatus, refresh]);
  return (
    <section aria-label="Bot run history" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Run history</h3>
        <Button
          size="xs"
          variant="ghost"
          disabled={!connected || query.isPending}
          onClick={query.refresh}
        >
          Refresh
        </Button>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      ) : query.data ? (
        <>
          {query.data.runs.length ? (
            <div className="divide-y divide-border/60">
              {query.data.runs.map((entry) => (
                <Link
                  key={entry.messageId}
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: entry.threadId }}
                  className="flex items-center gap-3 rounded-sm py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Clock3 size={16} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm">{entry.threadTitle || task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>{" "}
                      · {entry.status?.replaceAll("_", " ") ?? "Queued"}
                    </p>
                  </div>
                  <ArrowUpRight size={15} className="shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">No runs yet</p>
          )}
          <div className="flex gap-2">
            {before && (
              <Button size="sm" variant="ghost" onClick={() => setBefore(undefined)}>
                Latest runs
              </Button>
            )}
            {query.data.nextCursor && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBefore(query.data?.nextCursor ?? undefined)}
              >
                Older runs
              </Button>
            )}
          </div>
        </>
      ) : (
        <p role="status" className="py-4 text-sm text-muted-foreground">
          {connected ? "Loading runs…" : "Reconnect this bot’s host to see its runs."}
        </p>
      )}
    </section>
  );
}
