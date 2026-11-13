import { ProjectTeamsDialog } from "./ProjectTeams";
import { openCommandPalette } from "../commandPaletteBus";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import {
  BotId,
  EnvironmentId,
  ProjectId,
  HOME_BOT_ID,
  PUCKO_HOME_THREAD_ID,
} from "@t3tools/contracts";
import { newThreadId } from "../lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useBots, useOpenBotConversation } from "./useBots";
import { BotAvatar } from "./BotAvatar";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { RelativeTime } from "../components/RelativeTime";
import {
  botActivity,
  needsYouReason,
  threadNeedsYou,
  threadWorkState,
  WORK_STATE_LABEL,
  type WorkState,
} from "./workState";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SaveResultButton } from "./SaveResultButton";
import { inboxSummary } from "./inboxSummary";
import { NimaDialog } from "./NimaDialog";
import styles from "./nima.module.css";
import desk from "./DeskBoard.module.css";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useRef, useState, type ReactNode } from "react";
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
  return {
    threads,
    dailyDate,
    review,
    active: threads.filter((thread) => {
      const meta = review.metadata.get(keyFor(thread));
      if (
        // Pucko's conversation lives in his own app, like the Assistant's and each Bot's.
        thread.id === PUCKO_HOME_THREAD_ID ||
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
      if (threadRuntimeIsActive(thread.runtime) || threadNeedsYou(thread)) return true;
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

const WORK_GROUPS: { label: string; states: readonly WorkState[] }[] = [
  { label: "Needs you", states: ["needs-you"] },
  { label: "Working", states: ["working", "queued"] },
  { label: "Ready", states: ["ready"] },
  { label: "Stopped", states: ["stopped"] },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Names the opened tile and the arriving conversation alike, so the route's view transition
 * grows the tile into the thread. The names clear once the one-shot transition is over.
 */
export function markSessionTransition(tile: HTMLElement) {
  if (prefersReducedMotion() || !("startViewTransition" in document)) return;
  const root = document.documentElement;
  tile.style.viewTransitionName = "bara-session";
  root.dataset.baraTransition = "session";
  window.setTimeout(() => {
    tile.style.viewTransitionName = "";
    delete root.dataset.baraTransition;
  }, 700);
}

const REVIEW_LANE_LIMIT = 4;

const WORK_STATE_ORDER: Record<WorkState, number> = {
  "needs-you": 0,
  working: 1,
  queued: 2,
  stopped: 3,
  ready: 4,
};

export function sortByWorkState<T>(entries: readonly T[], state: (entry: T) => WorkState): T[] {
  return [...entries].sort((a, b) => WORK_STATE_ORDER[state(a)] - WORK_STATE_ORDER[state(b)]);
}

/** The pulse is the shared stepped `status-pulse`, so it never repaints every frame. */
export function WorkStateDot({ state }: { state: WorkState }) {
  return (
    <span
      aria-hidden
      className={`${styles["bara-state-dot"]} ${state === "working" ? "motion-safe:animate-status-pulse" : ""}`}
      data-work-state={state}
    />
  );
}

export function ConversationList({
  botId,
  environmentId,
  projectId,
  view,
  review: reviewPage,
  new: startNew,
}: {
  botId?: BotId;
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
  view?: "projects";
  /** The "To review" view, rendered in place of the sessions board. */
  review?: ReactNode;
  new?: true;
}) {
  const { active, review, threads } = useWorkspaceThreads();
  const navigate = useNavigate();
  const team = useBots();
  const openBot = useOpenBotConversation(team.environmentId);
  // Only Bots doing something real right now; an idle team is not news.
  const onIt = team.bots.flatMap((bot) => {
    if (bot.home || bot.archived) return [];
    const now = botActivity({
      bot,
      environmentId: team.environmentId,
      threads,
      metaFor: (thread) =>
        review.metadata.get(
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
        ),
    });
    return now ? [{ bot, now }] : [];
  });
  const { environments } = useEnvironments();
  const projects = useProjects();
  const project = projects.find(
    (entry) => entry.id === projectId && entry.environmentId === environmentId,
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(Boolean(startNew));
  const router = useRouter();
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
  const rows = items.map((thread) => {
    const key = keyFor(thread);
    const meta = review.metadata.get(key);
    const state = threadWorkState(thread, Boolean(meta?.assistantWorkPending || meta?.workPending));
    return { thread, key, meta, state };
  });
  const toReview = review.items.filter(
    (item) =>
      item.state === "review" &&
      (!environmentId || item.environmentId === environmentId) &&
      !botId &&
      !projectId &&
      `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()),
  );
  const summary = WORK_GROUPS.flatMap((group) => {
    const count = rows.filter((row) => group.states.includes(row.state)).length;
    return count ? [`${count} ${group.label.toLowerCase()}`] : [];
  }).join(" · ");
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
          <h1>{project?.title ?? "Desk"}</h1>
          {view !== "projects" && (summary || review.pendingCount > 0) && (
            <p>
              {[summary, review.pendingCount ? `${review.pendingCount} to review` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
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
        <Link
          to="/work"
          search={{}}
          aria-current={!view && !projectId && !reviewPage ? "page" : undefined}
        >
          Sessions
        </Link>
        <Link to="/inbox" aria-current={reviewPage ? "page" : undefined}>
          To review{review.pendingCount ? ` · ${review.pendingCount}` : ""}
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
      {reviewPage ? (
        reviewPage
      ) : view === "projects" ? (
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
          {onIt.length > 0 && (
            <section className={desk.team} aria-label="Bots at work">
              {onIt.map(({ bot, now }) => (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => void openBot.openConversation(bot)}
                  data-work-state={now.state}
                >
                  <span aria-hidden>
                    <BotAvatar
                      avatar={bot.config.avatar}
                      name={bot.config.name}
                      seed={bot.id}
                      fill
                    />
                  </span>
                  <strong>{bot.config.name}</strong>
                  <small>{now.text}</small>
                </button>
              ))}
            </section>
          )}
          <div className={desk.board}>
            {toReview.length > 0 && (
              <section aria-label="To review" className={desk.lane} data-work-state="review">
                <h2>
                  <WorkStateDot state="ready" />
                  To review
                  <span>{review.pendingCount || toReview.length}</span>
                </h2>
                <ul>
                  {toReview.slice(0, REVIEW_LANE_LIMIT).map((item) => (
                    <li
                      key={`${item.environmentId}:${item.key}`}
                      className={desk.tile}
                      data-work-state="ready"
                    >
                      <Link
                        to="/$environmentId/$threadId"
                        params={{ environmentId: item.environmentId, threadId: item.threadId }}
                      >
                        <strong>{item.title}</strong>
                        <small>{inboxSummary(item.summary) || "Finished"}</small>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link to="/inbox" className={desk.more}>
                  Review all →
                </Link>
              </section>
            )}
            {WORK_GROUPS.map((group) => {
              const groupRows = rows.filter((row) => group.states.includes(row.state));
              if (!groupRows.length) return null;
              return (
                <section
                  key={group.label}
                  aria-label={group.label}
                  className={desk.lane}
                  data-work-state={group.states[0]}
                >
                  <h2>
                    <WorkStateDot state={group.states[0]!} />
                    {group.label}
                    <span>{groupRows.length}</span>
                  </h2>
                  <ul>
                    {groupRows.map(({ thread, key, meta, state }) => {
                      const running = state === "working" || state === "queued";
                      const canWrite = review.hosts.find(
                        (host) => host.environmentId === thread.environmentId,
                      )?.canWrite;
                      const startedAt = thread.runtime?.activityStartedAt;
                      const title = meta?.title || focus[key]?.title || thread.title;
                      return (
                        <li key={key} className={desk.tile} data-work-state={state}>
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId: thread.environmentId, threadId: thread.id }}
                            viewTransition={!prefersReducedMotion()}
                            onClick={(event) => markSessionTransition(event.currentTarget)}
                          >
                            {(state === "needs-you" || running) && (
                              <span className={desk.status} data-work-state={state}>
                                <WorkStateDot state={state} />
                                {state === "needs-you"
                                  ? needsYouReason(thread)
                                  : WORK_STATE_LABEL[state]}
                                {running && startedAt ? (
                                  <>
                                    {" · "}
                                    <RelativeTime timestamp={startedAt} />
                                  </>
                                ) : null}
                              </span>
                            )}
                            <strong>{title}</strong>
                            <small>
                              {meta?.objective ||
                                focus[key]?.objective ||
                                thread.source.latestVisibleMessage?.text ||
                                "Focus session"}
                            </small>
                            {(() => {
                              const bot = team.bots.find(
                                (entry) =>
                                  entry.id === meta?.coordinatorBotId &&
                                  team.environmentId === thread.environmentId,
                              );
                              return bot ? (
                                <span className={desk.assignee}>
                                  <span aria-hidden>
                                    <BotAvatar
                                      avatar={bot.config.avatar}
                                      name={bot.config.name}
                                      seed={bot.id}
                                      fill
                                    />
                                  </span>
                                  {bot.config.name}
                                </span>
                              ) : null;
                            })()}
                          </Link>
                          <div className={desk.actions}>
                            {thread.latestRun?.completedAt && (
                              <SaveResultButton
                                key={thread.latestRun.runId}
                                environmentId={thread.environmentId}
                                threadId={thread.id}
                                runId={thread.latestRun.runId}
                                title={title}
                              />
                            )}
                            <button
                              disabled={!canWrite || pending !== null || running}
                              onClick={() => void update(thread, false)}
                            >
                              Send to review
                            </button>
                            <button
                              disabled={!canWrite || pending !== null || running}
                              onClick={() => void update(thread, true)}
                            >
                              Retire
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          {!items.length && (
            <div className={styles["nima-empty"]}>
              <span>
                <Layers size={26} />
              </span>
              <h2>{query ? "No matching conversations" : "Nothing in progress"}</h2>
              <p>
                {query
                  ? "Try a different search."
                  : `Start a Focus session${project ? ` in ${project.title}` : ""} and it stays here while the agent works.`}
              </p>
              {!query && review.pendingCount > 0 && (
                <Link to="/inbox" className={styles["bara-empty-link"]}>
                  {review.pendingCount} finished{" "}
                  {review.pendingCount === 1 ? "result is" : "results are"} waiting in Inbox →
                </Link>
              )}
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
          onClose={() => {
            setCreating(false);
            if (startNew && router.state.location.pathname === "/work")
              void navigate({
                from: "/work",
                to: "/work",
                search: ({ new: _, ...rest }) => rest,
                replace: true,
              });
          }}
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
