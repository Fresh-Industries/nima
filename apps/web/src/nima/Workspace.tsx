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
import { useBots } from "./useBots";
import { BotAvatar } from "./BotAvatar";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { RelativeTime } from "../components/RelativeTime";
import {
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

// The Desk reads top to bottom by how much each thing wants from you.
const DESK_SECTIONS: { id: string; label: string; states: readonly WorkState[] }[] = [
  { id: "needs-you", label: "Needs you", states: ["needs-you"] },
  { id: "review", label: "To review", states: [] },
  { id: "working", label: "Working", states: ["working", "queued"] },
  { id: "idle", label: "Idle", states: ["ready", "stopped"] },
];

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
  const { active, review } = useWorkspaceThreads();
  const navigate = useNavigate();
  const team = useBots();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const project = projects.find(
    (entry) => entry.id === projectId && entry.environmentId === environmentId,
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(Boolean(startNew));
  const [draft, setDraft] = useState("");
  const [showIdle, setShowIdle] = useState(false);
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
  const urgent =
    toReview.length +
    rows.filter((row) => row.state === "needs-you" || row.state === "working").length;
  const settle = async (item: (typeof toReview)[number]) => {
    if (pending) return;
    setPending(item.key);
    setError("");
    const result = await write({
      environmentId: item.environmentId,
      input: { action: "settle", key: item.key, version: item.version },
    });
    if (result._tag !== "Success") setError(formatEnvironmentQueryError(result.cause));
    setPending(null);
  };
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
      <header className={desk.header}>
        <div>
          <h1>{project?.title ?? (reviewPage ? "To review" : "Desk")}</h1>
          {!reviewPage && view !== "projects" && (summary || review.pendingCount > 0) && (
            <p>
              {[summary, review.pendingCount ? `${review.pendingCount} to review` : ""]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
        <nav aria-label="Desk views">
          {(reviewPage || view === "projects" || projectId || botId) && (
            <Link to="/work" search={{}}>
              ← Desk
            </Link>
          )}
          {view !== "projects" && (
            <Link to="/work" search={{ view: "projects" }}>
              Projects
            </Link>
          )}
          <button onClick={() => setManagingTeams(true)}>Project teams</button>
          {view === "projects" && (
            <button onClick={() => openCommandPalette({ open: "add-project" })}>
              <Plus size={14} /> Add project
            </button>
          )}
        </nav>
      </header>
      {reviewPage ? (
        reviewPage
      ) : view === "projects" ? (
        <WorkProjects query={query} onQuery={setQuery} />
      ) : (
        <>
          <form
            className={desk.composer}
            onSubmit={(event) => {
              event.preventDefault();
              setCreating(true);
            }}
          >
            <input
              aria-label="Start new work"
              placeholder={
                project ? `What should we work on in ${project.title}?` : "What should we work on?"
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" aria-label="New session">
              <ArrowUpRight size={16} />
            </button>
          </form>
          {botId && <p className="text-sm text-muted-foreground">Work coordinated by this Bot.</p>}
          {rows.length + toReview.length > 6 && (
            <label className={desk.filter}>
              <Search size={14} />
              <input
                aria-label="Search conversations"
                placeholder="Filter…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
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
                {host.label} needs a Bara backend for review and Studio. Its conversations are still
                available.
              </p>
            ))}
          {DESK_SECTIONS.map((section) => {
            const sessionRows = rows.filter((row) => section.states.includes(row.state));
            const reviews = section.id === "review" ? toReview : [];
            const count = sessionRows.length + reviews.length;
            if (!count) return null;
            // Idle work steps aside when something more pressing is on the Desk.
            const foldable = section.id === "idle" && urgent > 0 && count > 3;
            const folded = foldable && !showIdle;
            return (
              <section
                key={section.id}
                aria-label={section.label}
                className={desk.section}
                data-section={section.id}
              >
                <h2>
                  {section.label}
                  <span>{section.id === "review" ? review.pendingCount || count : count}</span>
                  {foldable && (
                    <button aria-expanded={!folded} onClick={() => setShowIdle(folded)}>
                      {folded ? "Show" : "Hide"}
                    </button>
                  )}
                  {section.id === "review" && <Link to="/inbox">Open review →</Link>}
                </h2>
                {!folded && (
                  <ul>
                    {reviews.map((item) => (
                      <li key={`${item.environmentId}:${item.key}`} className={desk.row}>
                        <Link
                          to="/$environmentId/$threadId"
                          params={{ environmentId: item.environmentId, threadId: item.threadId }}
                          viewTransition={!prefersReducedMotion()}
                          onClick={(event) => markSessionTransition(event.currentTarget)}
                        >
                          <WorkStateDot state="ready" />
                          <span className={desk.main}>
                            <strong>{item.title}</strong>
                            <small>{inboxSummary(item.summary) || "Finished"}</small>
                          </span>
                          <span className={desk.when}>
                            <RelativeTime timestamp={item.completedAt} />
                          </span>
                          <span className={desk.cta}>Review</span>
                        </Link>
                        <div className={desk.actions}>
                          <button disabled={pending !== null} onClick={() => void settle(item)}>
                            Settle
                          </button>
                        </div>
                      </li>
                    ))}
                    {sessionRows.map(({ thread, key, meta, state }) => {
                      const running = state === "working" || state === "queued";
                      const canWrite = review.hosts.find(
                        (host) => host.environmentId === thread.environmentId,
                      )?.canWrite;
                      const startedAt = thread.runtime?.activityStartedAt;
                      const title = meta?.title || focus[key]?.title || thread.title;
                      const bot = team.bots.find(
                        (entry) =>
                          entry.id === meta?.coordinatorBotId &&
                          team.environmentId === thread.environmentId,
                      );
                      return (
                        <li key={key} className={desk.row} data-work-state={state}>
                          <Link
                            to="/$environmentId/$threadId"
                            params={{ environmentId: thread.environmentId, threadId: thread.id }}
                            viewTransition={!prefersReducedMotion()}
                            onClick={(event) => markSessionTransition(event.currentTarget)}
                          >
                            <WorkStateDot state={state} />
                            <span className={desk.main}>
                              <strong>{title}</strong>
                              <small>
                                {state === "needs-you"
                                  ? needsYouReason(thread)
                                  : meta?.objective ||
                                    focus[key]?.objective ||
                                    thread.source.latestVisibleMessage?.text ||
                                    WORK_STATE_LABEL[state]}
                              </small>
                            </span>
                            {bot && (
                              <span className={desk.who}>
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
                            )}
                            <span className={desk.when}>
                              <RelativeTime
                                timestamp={running && startedAt ? startedAt : thread.updatedAt}
                              />
                            </span>
                            <span className={desk.cta}>
                              {state === "needs-you" ? "Reply" : "Open"}
                            </span>
                          </Link>
                          {!running && state !== "needs-you" && (
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
                                disabled={!canWrite || pending !== null}
                                onClick={() => void update(thread, false)}
                              >
                                Send to review
                              </button>
                              <button
                                disabled={!canWrite || pending !== null}
                                onClick={() => void update(thread, true)}
                              >
                                Retire
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          {!items.length && !toReview.length && (
            <div className={styles["nima-empty"]}>
              <span>
                <Layers size={26} />
              </span>
              <h2>{query ? "Nothing matches" : "Your Desk is clear"}</h2>
              <p>
                {query
                  ? "Try a different filter."
                  : `Type what you want done${project ? ` in ${project.title}` : ""} above and it stays here while the agent works.`}
              </p>
            </div>
          )}
        </>
      )}
      {managingTeams && <ProjectTeamsDialog onClose={() => setManagingTeams(false)} />}
      {creating && (
        <NewFocus
          objective={draft}
          {...(botId ? { coordinatorBotId: botId } : {})}
          {...(environmentId ? { environmentId } : {})}
          {...(projectId ? { projectId } : {})}
          onClose={() => {
            setCreating(false);
            setDraft("");
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
  objective: initialObjective = "",
}: {
  onClose: () => void;
  /** What was typed on the Desk; its first words become the title. */
  objective?: string;
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
  const [title, setTitle] = useState(() =>
    initialObjective.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 60),
  );
  const [objective, setObjective] = useState(initialObjective.trim());
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
