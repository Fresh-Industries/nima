import { ProjectTeamsDialog } from "./ProjectTeams";
import { openCommandPalette } from "../commandPaletteBus";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import { BotId, EnvironmentId, ProjectId, HOME_BOT_ID } from "@t3tools/contracts";
import { newThreadId } from "../lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useBots } from "./useBots";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SaveResultButton } from "./SaveResultButton";
import { useStableCallback } from "../hooks/useStableCallback";
import { NimaDialog } from "./NimaDialog";
import styles from "./nima.module.css";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Layers, Plus, ArrowUpRight, X, Search, Folder, Settings } from "lucide-react";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { useThreadActions } from "../hooks/useThreadActions";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNimaStore } from "./store";
import { useDay } from "./useDay";
import { useScratchProject } from "../hooks/useScratchProject";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { useAtomCommand } from "../state/use-atom-command";
import { serverEnvironment } from "../state/server";
import { formatEnvironmentQueryError } from "../state/query";

function refFor(thread: EnvironmentThreadShell) {
  return scopeThreadRef(thread.environmentId, thread.id);
}
function keyFor(thread: EnvironmentThreadShell) {
  return scopedThreadKey(refFor(thread));
}
export function useWorkspaceThreads() {
  const threads = useVisibleThreadShells();
  const daily = useNimaStore((state) => state.daily);
  const focus = useNimaStore((state) => state.focus);
  const legacyAssistant = useNimaStore((state) => state.assistantConversation);
  const personal = usePersonalAssistant();
  const botDirectory = useBots();
  const assistant =
    personal.profile?.threadId && personal.environmentId
      ? { environmentId: personal.environmentId, threadId: personal.profile.threadId }
      : legacyAssistant;
  const today = useDay();
  const dailyDate = (thread: EnvironmentThreadShell) =>
    assistant?.environmentId === thread.environmentId && assistant.threadId === thread.id
      ? today
      : Object.entries(daily).find(
          ([, value]) =>
            value.environmentId === thread.environmentId && value.threadId === thread.id,
        )?.[0];
  const review = useWorkspaceReview();
  const needsInput = (thread: EnvironmentThreadShell) =>
    thread.hasPendingApprovals || thread.hasPendingUserInput || thread.hasActionableProposedPlan;
  return {
    threads,
    dailyDate,
    review,
    active: threads.filter((thread) => {
      const meta = review.metadata.get(keyFor(thread));
      if (
        meta?.kind === "assistant" ||
        dailyDate(thread) ||
        (botDirectory.environmentId === thread.environmentId &&
          botDirectory.bots.some((bot) => bot.threadId === thread.id))
      )
        return false;
      if (
        (thread.lineage.relationshipToParent === "subagent" || thread.lineage.sideChat) &&
        meta?.kind !== "focus"
      )
        return false;
      if (threadRuntimeIsActive(thread.runtime) || needsInput(thread)) return true;
      if (meta?.state === "review" || meta?.state === "settled") return false;
      if (meta?.state === "active") return true;
      if (thread.settledAt || meta?.latestRunIsBot) return false;
      return Boolean(
        focus[keyFor(thread)] ||
        thread.title !== "New thread" ||
        thread.source.latestVisibleMessage,
      );
    }),
  };
}

export function ThreadPreview({
  thread,
  onOpen,
  showWorking = false,
  backgroundWorking = false,
  title,
}: {
  thread: EnvironmentThreadShell;
  onOpen: () => void;
  showWorking?: boolean;
  backgroundWorking?: boolean | undefined;
  title?: string | undefined;
}) {
  const metadata = useNimaStore((state) => state.focus[keyFor(thread)]);
  const working =
    backgroundWorking ||
    threadRuntimeIsActive(thread.runtime) ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
  return (
    <Link
      className={styles["nima-thread-preview"]}
      to="/$environmentId/$threadId"
      params={{ environmentId: thread.environmentId, threadId: thread.id }}
      onClick={onOpen}
    >
      <span className={[styles["nima-dot"], working ? styles.running : ""].join(" ")} />
      <span>{title || metadata?.title || thread.title}</span>
      {showWorking && working && <small>· Working</small>}
    </Link>
  );
}

export function Today() {
  const assistant = usePersonalAssistant();
  const canOpen = useAtomValue(
    serverEnvironment.openPersonalAgent.permissionAtom(assistant.environmentId),
  );
  const open = useAtomCommand(serverEnvironment.openPersonalAgent, { reportFailure: false });
  const navigate = useNavigate();
  const router = useRouter();
  const opening = useRef(false);
  const [error, setError] = useState("");
  const openAssistant = useStableCallback(async () => {
    if (opening.current || !assistant.connected || !assistant.environmentId || !assistant.profile)
      return;
    const environmentId = assistant.environmentId;
    opening.current = true;
    let threadId = assistant.profile.threadId;
    if (canOpen) {
      const legacy = useNimaStore.getState().assistantConversation;
      const result = await open({
        environmentId,
        input: {
          legacyConfig: assistant.legacy,
          ...(legacy?.environmentId === environmentId ? { legacyThreadId: legacy.threadId } : {}),
        },
      });
      if (result._tag !== "Success") {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not open your assistant.");
        opening.current = false;
        return;
      }
      threadId = result.value.threadId;
      if (threadId && legacy?.environmentId === environmentId) {
        const drafts = useComposerDraftStore.getState();
        const pending = drafts.getDraftSession(legacy.draftId);
        if (pending && !pending.promotedTo)
          drafts.moveComposerPromptAndImages(
            legacy.draftId,
            scopeThreadRef(environmentId, threadId),
          );
      }
    }
    if (!threadId) setError("Ask the workspace owner to initialize the personal assistant.");
    else if (router.state.location.pathname === "/")
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
        replace: true,
      });
    opening.current = false;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves the server-owned canonical conversation after the primary connection becomes ready
  useEffect(() => {
    if (assistant.connected && assistant.profile) void openAssistant();
  }, [assistant.connected, assistant.profile, openAssistant]);
  return (
    <main className={styles["nima-chat-opening"]}>
      <div className={styles["nima-assistant-avatar"]} aria-hidden="true">
        {assistant.config.avatar}
      </div>
      <h1>{assistant.config.name}</h1>
      <p role="status">
        {error ||
          assistant.query.error ||
          (assistant.connected ? "Opening your conversation…" : "Connecting to your assistant…")}
      </p>
      {(error || assistant.query.error) && (
        <button
          className={styles["nima-action"]}
          onClick={() => {
            setError("");
            assistant.query.refresh();
            void openAssistant();
          }}
        >
          Try again
        </button>
      )}
    </main>
  );
}

export function ConversationList({
  botId,
  environmentId,
  projectId,
  view,
}: {
  botId?: BotId;
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  view?: "projects";
}) {
  const { active, review } = useWorkspaceThreads();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const project = projects.find(
    (entry) => entry.id === projectId && entry.environmentId === environmentId,
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [managingTeams, setManagingTeams] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const focus = useNimaStore((state) => state.focus);
  const { settleThread } = useThreadActions();
  const write = useAtomCommand(serverEnvironment.writeWorkspaceReview, { reportFailure: false });
  const items = active.filter(
    (thread) =>
      (!environmentId || thread.environmentId === environmentId) &&
      (!projectId || thread.projectId === projectId) &&
      (!botId || review.metadata.get(keyFor(thread))?.coordinatorBotId === botId) &&
      `${thread.title} ${review.metadata.get(keyFor(thread))?.objective ?? focus[keyFor(thread)]?.objective ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const update = async (thread: EnvironmentThreadShell, retire: boolean) => {
    if (pending) return;
    setPending(keyFor(thread));
    setError("");
    const result = retire
      ? await settleThread(refFor(thread))
      : await write({
          environmentId: thread.environmentId,
          input: { action: "request", threadId: thread.id },
        });
    if (result._tag !== "Success") setError(formatEnvironmentQueryError(result.cause));
    else if (!retire) await navigate({ to: "/inbox" });
    setPending(null);
  };
  return (
    <main className={styles["nima-page"]}>
      <header className={styles["nima-page-header"]}>
        <div>
          <h1>{project?.title ?? "Work"}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setManagingTeams(true)}
          >
            Project teams
          </button>
          <button
            className={styles["nima-action"]}
            onClick={() =>
              view === "projects" ? openCommandPalette({ open: "add-project" }) : setCreating(true)
            }
          >
            <Plus size={15} />
            {view === "projects" ? "Add project" : "Focus session"}
          </button>
        </div>
      </header>
      <nav className={styles["bara-work-tabs"]} aria-label="Work views">
        <Link to="/work" search={{}} aria-current={!view && !projectId ? "page" : undefined}>
          Sessions
        </Link>
        <Link
          to="/work"
          search={{ view: "projects" }}
          aria-current={view === "projects" ? "page" : undefined}
        >
          Projects
        </Link>
        {project && <span>{project.title}</span>}
      </nav>
      {view === "projects" ? (
        <WorkProjects query={query} onQuery={setQuery} />
      ) : (
        <>
          {botId && (
            <p className="text-sm text-muted-foreground">
              Work coordinated by this Bot.{" "}
              <Link to="/work" search={{}}>
                View all work →
              </Link>
            </p>
          )}
          <div className={styles["nima-list-toolbar"]}>
            <label className={styles["nima-search"]}>
              <Search size={15} />
              <input
                aria-label="Search conversations"
                placeholder="Search conversations…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
          {review.errors.map((message) => (
            <p role="alert" key={message}>
              {message}
            </p>
          ))}
          {environments
            .filter(
              (host) =>
                host.connection.phase === "connected" &&
                !review.hosts.some((entry) => entry.environmentId === host.environmentId) &&
                items.some((thread) => thread.environmentId === host.environmentId),
            )
            .map((host) => (
              <p key={host.environmentId} className="text-sm text-muted-foreground">
                {host.label} needs a Bara backend for Inbox and Studio. Its conversations are still
                available.
              </p>
            ))}
          <div className={styles["nima-conversation-list"]}>
            {items.map((thread) => {
              const key = keyFor(thread);
              const meta = review.metadata.get(key);
              const running =
                threadRuntimeIsActive(thread.runtime) ||
                Boolean(meta?.assistantWorkPending || meta?.workPending) ||
                backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks);
              const canWrite = review.hosts.find(
                (host) => host.environmentId === thread.environmentId,
              )?.canWrite;
              return (
                <article className={styles["nima-conversation"]} key={key}>
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId: thread.environmentId, threadId: thread.id }}
                  >
                    <span className={styles["nima-thread-project"]}>
                      {meta?.coordinatorBotId ? "Coordinated work" : "Focus session"}
                    </span>
                    <h2>{meta?.title || focus[key]?.title || thread.title}</h2>
                    <p>
                      {meta?.objective ||
                        focus[key]?.objective ||
                        thread.source.latestVisibleMessage?.text ||
                        "Open the conversation to continue."}
                    </p>
                    <small>
                      {thread.hasPendingApprovals ||
                      thread.hasPendingUserInput ||
                      thread.hasActionableProposedPlan
                        ? "Needs your input"
                        : running
                          ? "Agent working"
                          : "Ready to continue"}
                    </small>
                  </Link>
                  <div className={styles["nima-row-actions"]}>
                    {thread.latestRun?.completedAt && (
                      <SaveResultButton
                        key={thread.latestRun.runId}
                        environmentId={thread.environmentId}
                        threadId={thread.id}
                        runId={thread.latestRun.runId}
                        title={meta?.title || thread.title}
                      />
                    )}
                    <button
                      disabled={!canWrite || pending !== null || running}
                      onClick={() => void update(thread, false)}
                    >
                      Send to Inbox
                    </button>
                    <button
                      disabled={!canWrite || pending !== null || running}
                      onClick={() => void update(thread, true)}
                    >
                      Retire
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!items.length && (
            <div className={styles["nima-empty"]}>
              <span>
                <Layers size={26} />
              </span>
              <h2>{query ? "No matching conversations" : "No active sessions"}</h2>
              <p>Start a focus session{project ? ` in ${project.title}` : ""}.</p>
            </div>
          )}
        </>
      )}
      {managingTeams && <ProjectTeamsDialog onClose={() => setManagingTeams(false)} />}
      {creating && (
        <NewFocus
          {...(botId ? { coordinatorBotId: botId } : {})}
          {...(environmentId ? { environmentId } : {})}
          {...(projectId ? { projectId } : {})}
          onClose={() => setCreating(false)}
        />
      )}
    </main>
  );
}

function WorkProjects({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { environments } = useEnvironments();
  const scratch = useScratchProject();
  const projects = useProjects().filter(
    (project) =>
      project.archivedAt == null &&
      !project.isScratch &&
      (project.title !== "No project" || !/[/\\]scratch$/i.test(project.workspaceRoot)) &&
      project.workspaceRoot !== scratch.scratchWorkspaceRootFor(project.environmentId) &&
      `${project.title} ${project.workspaceRoot}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section aria-label="Projects">
      <div className={styles["nima-list-toolbar"]}>
        <label className={styles["nima-search"]}>
          <Search size={15} />
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
      </div>
      <div className={styles["bara-project-list"]}>
        {projects.map((project) => (
          <article key={`${project.environmentId}:${project.id}`}>
            <Link
              to="/work"
              search={{ environmentId: project.environmentId, projectId: project.id }}
            >
              <Folder size={20} />
              <div>
                <strong>{project.title}</strong>
                <small>
                  {environments.find((host) => host.environmentId === project.environmentId)?.label}{" "}
                  · {project.workspaceRoot}
                </small>
              </div>
              <ArrowUpRight size={16} />
            </Link>
            <Link
              to="/settings/projects"
              search={{
                project: derivePhysicalProjectKey(project),
                machine: project.environmentId,
              }}
              aria-label={`Settings for ${project.title}`}
            >
              <Settings size={16} />
            </Link>
          </article>
        ))}
      </div>
      {!projects.length && (
        <div className={styles["nima-empty"]}>
          <Folder size={26} />
          <h2>{query ? "No matching projects" : "Add your first project"}</h2>
          <p>Choose a folder, clone a repository, or create a new one.</p>
          <button
            className={styles["nima-action"]}
            onClick={() => openCommandPalette({ open: "add-project" })}
          >
            Add project
          </button>
        </div>
      )}
    </section>
  );
}

function NewFocus({
  onClose,
  environmentId: target,
  coordinatorBotId,
  projectId: initialProjectId,
}: {
  onClose: () => void;
  environmentId?: EnvironmentId;
  coordinatorBotId?: BotId;
  projectId?: ProjectId;
}) {
  const primary = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const connected = environments.filter((host) => host.connection.phase === "connected");
  const [chosenEnvironmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const environmentId =
    chosenEnvironmentId ?? target ?? primary ?? connected[0]?.environmentId ?? null;
  const directory = useBots(environmentId ?? undefined);
  const host = environments.find((entry) => entry.environmentId === environmentId);
  const supportsWork = host?.serverConfig?.environment.capabilities.botCapabilities === true;
  const scratch = useScratchProject();
  const projects = useProjects().filter(
    (project) =>
      project.archivedAt == null &&
      !project.isScratch &&
      (project.title !== "No project" || !/[/\\]scratch$/i.test(project.workspaceRoot)) &&
      project.environmentId === environmentId &&
      project.workspaceRoot !== scratch.scratchWorkspaceRootFor(environmentId),
  );
  const [projectId, setProjectId] = useState<ProjectId | null>(initialProjectId ?? null);
  const [botId, setBotId] = useState<BotId | null>(coordinatorBotId ?? HOME_BOT_ID);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; threadId: ReturnType<typeof newThreadId> } | null>(null);
  const canCreate = useAtomValue(serverEnvironment.createWorkSession.permissionAtom(environmentId));
  const create = useAtomCommand(serverEnvironment.createWorkSession, { reportFailure: false });
  const navigate = useNavigate();
  const submit = async () => {
    if (
      !environmentId ||
      busy ||
      !title.trim() ||
      !objective.trim() ||
      !canCreate ||
      !supportsWork ||
      !directory.connected
    )
      return;
    setBusy(true);
    setError("");
    const config = {
      title: title.trim(),
      objective: objective.trim(),
      projectId,
      coordinatorBotId: botId,
    };
    const key = JSON.stringify({ environmentId, ...config });
    if (attempt.current?.key !== key) attempt.current = { key, threadId: newThreadId() };
    const result = await create({
      environmentId,
      input: { ...config, threadId: attempt.current.threadId },
    });
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not create this Work session.");
      setBusy(false);
      return;
    }
    const ref = scopeThreadRef(environmentId, result.value.threadId);
    const drafts = useComposerDraftStore.getState();
    if (!drafts.getComposerDraft(ref)?.prompt)
      drafts.setPrompt(ref, `${config.title}\n\nObjective: ${config.objective}`);
    try {
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
      onClose();
    } catch {
      setBusy(false);
      setError("The session is saved. Open it from Work or try again.");
    }
  };
  return (
    <NimaDialog
      titleId="focus-title"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className={styles["nima-focus-form"]}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <p className={styles["nima-eyebrow"]}>A conversation with a purpose</p>
          <button
            type="button"
            aria-label="Close focus session dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <h1 id="focus-title">Start focused work.</h1>
        <label>
          Title
          <input
            autoFocus
            required
            maxLength={240}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What are we working on?"
          />
        </label>
        <label>
          Objective
          <textarea
            required
            maxLength={20000}
            value={objective}
            disabled={busy}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="What would a good outcome look like?"
          />
        </label>
        <label>
          Coordinator
          <select
            value={botId ?? ""}
            disabled={busy}
            onChange={(event) =>
              setBotId(event.target.value ? BotId.make(event.target.value) : null)
            }
          >
            <option value="">Unassigned</option>
            {directory.bots
              .filter((bot) => !bot.archived)
              .map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.config.name}
                </option>
              ))}
          </select>
        </label>
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Project & environment
          </summary>
          <div className="mt-4 space-y-4">
            {environments.length > 1 && (
              <label>
                Environment
                <select
                  value={environmentId ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    setEnvironmentId(EnvironmentId.make(event.target.value));
                    setProjectId(null);
                    setBotId(HOME_BOT_ID);
                  }}
                >
                  {environments.map((host) => (
                    <option
                      key={host.environmentId}
                      value={host.environmentId}
                      disabled={host.connection.phase !== "connected"}
                    >
                      {host.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Project
              <select
                value={projectId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setProjectId(event.target.value ? ProjectId.make(event.target.value) : null)
                }
              >
                <option value="">Personal · no project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <p className={styles["nima-subtle"]}>
          Each session has its own conversation. Review the objective in the composer and send it
          when you’re ready.
        </p>
        {!directory.connected && (
          <p role="status">Connect to this Bara environment to start Work.</p>
        )}
        {directory.connected && !canCreate && (
          <p role="status">This connection needs permission to start agent conversations.</p>
        )}
        {directory.connected && !supportsWork && (
          <p role="status">
            {host?.label ?? "This machine"} runs a server without Bara Work support. Update its
            server to Bara to use coordinators and Inbox review. Existing conversations remain
            available in Work.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className={styles["nima-action"] + " " + styles["primary"]}
          disabled={busy || !canCreate || !supportsWork || !environmentId || !directory.connected}
        >
          {busy ? "Opening…" : "Open focus session"}
          <ArrowUpRight size={15} />
        </button>
      </form>
    </NimaDialog>
  );
}
