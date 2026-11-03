import { NimaDialog } from "./NimaDialog";
import styles from "./nima.module.css";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  Sun,
  Layers,
  Inbox,
  Settings,
  PanelRight,
  Plus,
  ArrowUpRight,
  ChevronLeft,
  NotebookPen,
  X,
  Search,
} from "lucide-react";
import { useProjects, useVisibleThreadShells } from "../state/entities";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useThreadActions } from "../hooks/useThreadActions";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useComposerDraftStore } from "../composerDraftStore";
import { useRightPanelStore } from "../rightPanelStore";
import { useSidebar } from "../components/ui/sidebar";
import { useNimaStore, EMPTY_PLAN, type DailyConversation } from "./store";
import { useDay } from "./useDay";
import { PlanDay } from "./PlanDay";

function refFor(thread: EnvironmentThreadShell) {
  return scopeThreadRef(thread.environmentId, thread.id);
}
function keyFor(thread: EnvironmentThreadShell) {
  return scopedThreadKey(refFor(thread));
}
function useWorkspaceThreads() {
  const threads = useVisibleThreadShells();
  const daily = useNimaStore((state) => state.daily);
  const focus = useNimaStore((state) => state.focus);
  const today = useDay();
  const dailyDate = (thread: EnvironmentThreadShell) =>
    Object.entries(daily).find(
      ([, value]) => value.environmentId === thread.environmentId && value.threadId === thread.id,
    )?.[0];
  const history = (thread: EnvironmentThreadShell) => {
    const day = dailyDate(thread);
    return Boolean(
      thread.settledAt ||
      focus[keyFor(thread)]?.review ||
      thread.hasPendingApprovals ||
      thread.hasPendingUserInput ||
      thread.hasActionableProposedPlan ||
      (day && day !== today),
    );
  };
  return {
    threads,
    dailyDate,
    active: threads.filter((thread) => !history(thread) && !dailyDate(thread)),
    inbox: threads.filter(history),
  };
}

export function NimaSidebar({ advanced }: { advanced: ReactNode }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { active, inbox } = useWorkspaceThreads();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  return (
    <div className={styles["nima-sidebar"]}>
      <Link to="/" className={styles["nima-brand"]} onClick={closeMobile}>
        <span className={styles["nima-mark"]}>n</span>Nima
        <span className={styles["nima-brand-caption"]}>by Fresh Industries</span>
      </Link>
      <nav className={styles["nima-primary-nav"]} aria-label="Nima">
        <Link to="/" onClick={closeMobile} activeOptions={{ exact: true }}>
          <Sun size={18} />
          Today
        </Link>
        <Link to="/work" onClick={closeMobile}>
          <Layers size={18} />
          Work<span>{active.length || ""}</span>
        </Link>
        <Link to="/inbox" onClick={closeMobile}>
          <Inbox size={18} />
          Inbox<span>{inbox.length || ""}</span>
        </Link>
      </nav>
      <div className={styles["nima-sidebar-scroll"]}>
        <p className={styles["nima-section-label"]}>Active work</p>
        {active.slice(0, 5).map((thread) => (
          <ThreadPreview key={keyFor(thread)} thread={thread} onOpen={closeMobile} />
        ))}
        {!active.length && <p className={styles["nima-sidebar-empty"]}>Room for your next idea.</p>}
        <p className={styles["nima-section-label"]}>Recent inbox</p>
        {inbox.slice(0, 4).map((thread) => (
          <ThreadPreview key={keyFor(thread)} thread={thread} onOpen={closeMobile} />
        ))}
        {!inbox.length && <p className={styles["nima-sidebar-empty"]}>All quiet for now.</p>}
      </div>
      <div className={styles["nima-sidebar-bottom"]}>
        <button onClick={() => setShowAdvanced(!showAdvanced)}>
          <Layers size={16} />
          {showAdvanced ? "Close project explorer" : "Projects & agent controls"}
        </button>
        <Link to="/settings" onClick={closeMobile}>
          <Settings size={16} />
          Settings
        </Link>
      </div>
      {showAdvanced && (
        <div className={styles["nima-advanced"]}>
          <button onClick={() => setShowAdvanced(false)}>
            <ChevronLeft size={15} />
            Back to Nima
          </button>
          {advanced}
        </div>
      )}
    </div>
  );
}

function ThreadPreview({ thread, onOpen }: { thread: EnvironmentThreadShell; onOpen: () => void }) {
  const metadata = useNimaStore((state) => state.focus[keyFor(thread)]);
  return (
    <Link
      className={styles["nima-thread-preview"]}
      to="/$environmentId/$threadId"
      params={{ environmentId: thread.environmentId, threadId: thread.id }}
      onClick={onOpen}
    >
      <span
        className={[
          styles["nima-dot"],
          threadRuntimeIsActive(thread.runtime) ? styles.running : "",
        ].join(" ")}
      />
      <span>{metadata?.title ?? thread.title}</span>
    </Link>
  );
}

export function NimaFrame({ children }: { children: ReactNode }) {
  const [planOpen, setPlanOpen] = useState(false);
  const [tab, setTab] = useState("Work");
  const open = useNimaStore((state) => state.utilityOpen);
  const width = useNimaStore((state) => state.utilityWidth);
  const setOpen = useNimaStore((state) => state.setUtilityOpen);
  const setWidth = useNimaStore((state) => state.setUtilityWidth);
  const target = useThreadRouteTarget();
  const daily = useNimaStore((state) => state.daily);
  const day = useDay();
  const chiefName = useNimaStore((state) => state.chiefName);
  const isToday =
    target?.kind === "server"
      ? daily[day]?.threadId === target.threadRef.threadId &&
        daily[day]?.environmentId === target.threadRef.environmentId
      : target?.kind === "draft" && daily[day]?.draftId === target.draftId;
  const { active } = useWorkspaceThreads();
  const plan = useNimaStore((state) => state.plans[day] ?? EMPTY_PLAN);
  const nativeOpen = useRightPanelStore(
    (state) =>
      target?.kind === "server" &&
      Boolean(state.byThreadKey[scopedThreadKey(target.threadRef)]?.isOpen),
  );
  const launchPanel = (kind: "files" | "preview") => {
    if (target?.kind === "server") useRightPanelStore.getState().open(target.threadRef, kind);
  };
  return (
    <div className={styles["nima-frame"]}>
      <div className={styles["nima-center"]}>
        <div className={styles["nima-topbar"]}>
          <span>{isToday ? "Today · " + chiefName : "Your personal workspace"}</span>
          <div>
            <button onClick={() => setPlanOpen(true)}>
              <NotebookPen size={15} />
              Plan Day
            </button>
            <button
              aria-label="Toggle utility panel"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <PanelRight size={17} />
            </button>
          </div>
        </div>
        <div className={styles["nima-content"]}>{children}</div>
      </div>
      {open && !nativeOpen && (
        <aside
          className={styles["nima-utility"]}
          style={{ width }}
          aria-label="Workspace utilities"
        >
          <div
            className={styles["nima-resize"]}
            role="separator"
            aria-label="Resize utility panel"
            aria-orientation="vertical"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") setWidth(Math.min(480, width + 20));
              if (event.key === "ArrowRight") setWidth(Math.max(240, width - 20));
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                setWidth(Math.max(240, Math.min(480, window.innerWidth - event.clientX)));
            }}
          />
          <div className={styles["nima-utility-tabs"]} role="tablist" aria-label="Utility tabs">
            {["Work", "Notes", "Files", "Browser", "Tools"].map((name) => (
              <button
                role="tab"
                aria-selected={tab === name}
                key={name}
                onClick={() => {
                  setTab(name);
                  if (name === "Files") launchPanel("files");
                  if (name === "Browser") launchPanel("preview");
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div className={styles["nima-utility-body"]} role="tabpanel">
            {tab === "Work" && (
              <>
                <p className={styles["nima-section-label"]}>In motion</p>
                {active.map((thread) => (
                  <div className={styles["nima-utility-thread"]} key={keyFor(thread)}>
                    <ThreadPreview thread={thread} onOpen={() => {}} />
                    <small>
                      {threadRuntimeIsActive(thread.runtime)
                        ? "Agent working"
                        : thread.source.pendingRuntimeRequest
                          ? "Needs your input"
                          : "Ready to continue"}
                    </small>
                  </div>
                ))}
                {!active.length && (
                  <p>
                    No active focus sessions. Start with a conversation, and give deeper work a
                    space of its own.
                  </p>
                )}
                <Link to="/work">
                  View work <ArrowUpRight size={13} />
                </Link>
              </>
            )}
            {tab === "Notes" && (
              <>
                <p className={styles["nima-section-label"]}>Today’s notes</p>
                <p className={styles["nima-note-copy"]}>
                  {plan.notes || "A place for what’s on your mind."}
                </p>
                <button className={styles["nima-action"]} onClick={() => setPlanOpen(true)}>
                  Open daily notepad
                </button>
                <p className={styles["nima-utility-footnote"]}>
                  Shared knowledge and agent access are planned. Daily notes are currently saved in
                  this browser.
                </p>
              </>
            )}
            {(tab === "Files" || tab === "Browser") && (
              <>
                <p className={styles["nima-section-label"]}>{tab}</p>
                <p>
                  Open a saved conversation to use the existing{" "}
                  {tab === "Files" ? "project file explorer" : "development browser"} alongside your
                  agent.
                </p>
              </>
            )}
            {tab === "Tools" && (
              <>
                <p className={styles["nima-section-label"]}>Shared connections</p>
                <p>
                  Manage providers and integrations through the existing environment settings.
                  Access continues to follow T3 Code’s server permissions.
                </p>
                <Link to="/settings/providers">
                  Agent providers <ArrowUpRight size={13} />
                </Link>
                <Link to="/settings/integrations">
                  Integrations <ArrowUpRight size={13} />
                </Link>
                <p className={styles["nima-utility-footnote"]}>
                  A unified Nima tool registry is a future milestone.
                </p>
              </>
            )}
          </div>
        </aside>
      )}
      {planOpen && <PlanDay onClose={() => setPlanOpen(false)} />}
    </div>
  );
}

export function Today() {
  const day = useDay();
  const daily = useNimaStore((state) => state.daily[day]);
  const chiefName = useNimaStore((state) => state.chiefName);
  const timezone = useNimaStore((state) => state.timezone);
  const projects = useProjects().filter((project) => project.archivedAt == null);
  const [projectKey, setProjectKey] = useState("");
  const [configure, setConfigure] = useState(false);
  const [name, setName] = useState(chiefName);
  const [zone, setZone] = useState(timezone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const handleNewThread = useNewThreadHandler();
  const navigate = useNavigate();
  const openDaily = async () => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    setError("");
    try {
      const existing = useNimaStore.getState().daily[day];
      if (existing) {
        await openConversation(existing);
        return;
      }
      const project =
        projects.find((item) => `${item.environmentId}:${item.id}` === projectKey) ?? projects[0];
      if (!project) {
        setError("Add a workspace project using Projects & agent controls first.");
      } else {
        const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
          reuseEmptyDraft: false,
        });
        if (!opened) setError("The project is unavailable. Try again.");
        else
          useNimaStore
            .getState()
            .rememberDaily(day, { environmentId: project.environmentId, ...opened });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open today’s conversation.");
    }
    creating.current = false;
    setBusy(false);
  };
  const openConversation = async (conversation: DailyConversation) => {
    const store = useComposerDraftStore.getState();
    if (store.getDraftSession(conversation.draftId))
      await navigate({ to: "/draft/$draftId", params: { draftId: conversation.draftId } });
    else
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: conversation.environmentId, threadId: conversation.threadId },
      });
  };
  return (
    <main className={styles["nima-page"] + " " + styles["nima-today"]}>
      <div className={styles["nima-today-inner"]}>
        <p className={styles["nima-eyebrow"]}>
          {new Intl.DateTimeFormat(undefined, {
            timeZone: "UTC",
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(new Date(day + "T12:00:00Z"))}
        </p>
        <h1>
          A little clarity.
          <br />A little momentum.
        </h1>
        <p className={styles["nima-intro"]}>
          Think out loud, make a plan, or begin something.
          <br />
          This is your space with {chiefName}.
        </p>
        {!daily && projects.length > 1 && (
          <label className={styles["nima-field-label"]}>
            Conversation workspace
            <select value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
              <option value="">{projects[0]?.title}</option>
              {projects.map((project) => (
                <option
                  key={`${project.environmentId}:${project.id}`}
                  value={`${project.environmentId}:${project.id}`}
                >
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className={styles["nima-action"] + " " + styles["primary"]}
          disabled={busy}
          onClick={() => void openDaily()}
        >
          {busy
            ? "Opening…"
            : daily
              ? "Continue today’s conversation"
              : "Begin today’s conversation"}
          <ArrowUpRight size={16} />
        </button>
        <p className={styles["nima-subtle"]}>
          One conversation for the day. Deeper work has its own space.
        </p>
        {!projects.length && (
          <p className={styles["nima-subtle"]}>
            Add your first project through “Projects & agent controls” in the sidebar.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className={styles["nima-today-links"]}>
          <Link to="/work">
            <Layers size={16} />
            Open focused work
          </Link>
          <button onClick={() => setConfigure(!configure)}>
            <Settings size={15} />
            Personalize
          </button>
        </div>
        {configure && (
          <form
            className={styles["nima-config"]}
            onSubmit={(event) => {
              event.preventDefault();
              try {
                useNimaStore.getState().configure(name, zone);
                setConfigure(false);
                setError("");
              } catch {
                setError("Enter a valid IANA timezone, such as America/Chicago.");
              }
            }}
          >
            <label>
              Chief of Staff name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Your timezone
              <input value={zone} onChange={(event) => setZone(event.target.value)} />
            </label>
            <button className={styles["nima-action"]}>Save preferences</button>
            <p className={styles["nima-subtle"]}>
              The name is a display preference. Autonomous coordination is not yet connected.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

export function ConversationList({ inbox = false }: { inbox?: boolean }) {
  const { active, inbox: history, dailyDate } = useWorkspaceThreads();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const focus = useNimaStore((state) => state.focus);
  const projects = useProjects();
  const { settleThread, unsettleThread } = useThreadActions();
  const navigate = useNavigate();
  const items = (inbox ? history : active).filter((thread) => {
    const text = `${thread.title} ${focus[keyFor(thread)]?.title ?? ""} ${focus[keyFor(thread)]?.objective ?? ""} ${thread.source.latestVisibleMessage?.text ?? ""} ${projects.find((project) => project.id === thread.projectId && project.environmentId === thread.environmentId)?.title ?? ""}`;
    return (
      text.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All" ||
        (filter === "Settled"
          ? Boolean(thread.settledAt)
          : filter === "Daily"
            ? Boolean(dailyDate(thread))
            : !thread.settledAt))
    );
  });
  const lifecycle = async (thread: EnvironmentThreadShell, reopen: boolean) => {
    const key = keyFor(thread);
    if (pending) return;
    setPending(key);
    setError("");
    try {
      const result = await (reopen ? unsettleThread(refFor(thread)) : settleThread(refFor(thread)));
      if (result._tag !== "Success") {
        setError(
          "The server could not update this thread. Check the connection and permissions, and make sure no agent is running.",
        );
      } else {
        const metadata = useNimaStore.getState().focus[key];
        if (metadata) useNimaStore.getState().rememberFocus(key, { ...metadata, review: false });
        if (reopen)
          await navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: thread.environmentId, threadId: thread.id },
          });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the thread.");
    }
    setPending(null);
  };
  return (
    <main className={styles["nima-page"]}>
      <header className={styles["nima-page-header"]}>
        <div>
          <p className={styles["nima-eyebrow"]}>
            {inbox ? "A place to return to" : "Space to go deeper"}
          </p>
          <h1>{inbox ? "Inbox" : "Work"}</h1>
          <p>
            {inbox
              ? "Review, revisit, and bring things to a close."
              : "Focused conversations. Real progress."}
          </p>
        </div>
        {!inbox && (
          <button className={styles["nima-action"]} onClick={() => setCreating(true)}>
            <Plus size={15} />
            Focus session
          </button>
        )}
      </header>
      <div className={styles["nima-list-toolbar"]}>
        <div className={styles["nima-filters"]}>
          {(inbox ? ["All", "Review", "Settled", "Daily"] : ["All"]).map((name) => (
            <button
              className={name === filter ? styles.selected : ""}
              key={name}
              onClick={() => setFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
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
      <div className={styles["nima-conversation-list"]}>
        {items.map((thread) => {
          const key = keyFor(thread);
          const project = projects.find(
            (item) => item.id === thread.projectId && item.environmentId === thread.environmentId,
          );
          return (
            <article className={styles["nima-conversation"]} key={key}>
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.id }}
              >
                <span className={styles["nima-thread-project"]}>
                  {dailyDate(thread)
                    ? `Today · ${dailyDate(thread)}`
                    : (project?.title ?? "Workspace")}
                </span>
                <h2>{focus[key]?.title ?? thread.title}</h2>
                <p>
                  {focus[key]?.objective ||
                    thread.source.latestVisibleMessage?.text ||
                    "Open the conversation to continue."}
                </p>
                <small>
                  {threadRuntimeIsActive(thread.runtime)
                    ? "Agent working"
                    : thread.source.pendingRuntimeRequest
                      ? "Needs your input"
                      : thread.settledAt
                        ? "Settled"
                        : focus[key]?.review
                          ? "Awaiting review"
                          : "Ready to continue"}
                </small>
              </Link>
              <div className={styles["nima-row-actions"]}>
                {inbox ? (
                  <>
                    {!thread.settledAt && (
                      <button
                        disabled={
                          pending !== null || Boolean(threadRuntimeIsActive(thread.runtime))
                        }
                        onClick={() => void lifecycle(thread, false)}
                      >
                        Settle
                      </button>
                    )}
                    <button
                      disabled={pending !== null || Boolean(dailyDate(thread))}
                      onClick={() => void lifecycle(thread, true)}
                    >
                      Reopen
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      disabled={Boolean(threadRuntimeIsActive(thread.runtime))}
                      onClick={() =>
                        useNimaStore.getState().rememberFocus(key, {
                          title: focus[key]?.title ?? thread.title,
                          objective: focus[key]?.objective ?? "",
                          review: true,
                        })
                      }
                    >
                      Review
                    </button>
                    <button
                      disabled={pending !== null || Boolean(threadRuntimeIsActive(thread.runtime))}
                      onClick={() => void lifecycle(thread, false)}
                    >
                      Retire
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!items.length && (
        <div className={styles["nima-empty"]}>
          <span>{inbox ? <Inbox size={26} /> : <Layers size={26} />}</span>
          <h2>
            {query
              ? "No matching conversations"
              : inbox
                ? "Nothing needs your attention."
                : "Give an idea some space."}
          </h2>
          <p>
            {inbox
              ? "Completed work and previous daily conversations will be here."
              : "Create a focus session for the work you want to move forward."}
          </p>
        </div>
      )}
      {inbox && (
        <Link className={styles["nima-archive-link"]} to="/settings/archived">
          Browse archived conversations <ArrowUpRight size={14} />
        </Link>
      )}
      {creating && <NewFocus onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewFocus({ onClose }: { onClose: () => void }) {
  const projects = useProjects().filter((project) => project.archivedAt == null);
  const { active } = useWorkspaceThreads();
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handleNew = useNewThreadHandler();
  const project =
    projects.find((item) => `${item.environmentId}:${item.id}` === projectKey) ?? projects[0];
  const similar =
    title.trim().length > 2
      ? active.filter(
          (thread) =>
            thread.environmentId === project?.environmentId &&
            thread.projectId === project?.id &&
            (useNimaStore.getState().focus[keyFor(thread)]?.title ?? thread.title)
              .toLowerCase()
              .includes(title.trim().toLowerCase()),
        )
      : [];
  return (
    <NimaDialog titleId="focus-title" onClose={onClose}>
      <form
        className={styles["nima-focus-form"]}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !project || !title.trim() || !objective.trim()) return;
          setBusy(true);
          setError("");
          void handleNew(scopeProjectRef(project.environmentId, project.id), {
            prompt: `${title.trim()}\n\nObjective: ${objective.trim()}`,
            reuseEmptyDraft: false,
          })
            .then((opened) => {
              if (!opened) throw new Error("Project unavailable. Try again.");
              useNimaStore
                .getState()
                .rememberFocus(
                  scopedThreadKey(scopeThreadRef(project.environmentId, opened.threadId)),
                  { title: title.trim(), objective: objective.trim(), review: false },
                );
              onClose();
            })
            .catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Could not create a session.");
              setBusy(false);
            });
        }}
      >
        <header>
          <p className={styles["nima-eyebrow"]}>A conversation with a purpose</p>
          <button type="button" aria-label="Close focus session dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <h1 id="focus-title">Start focused work.</h1>
        <label>
          Title
          <input
            required
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What are we working on?"
          />
        </label>
        <label>
          Objective
          <textarea
            required
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="What would a good outcome look like?"
          />
        </label>
        <label>
          Project
          <select value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
            <option value="">{projects[0]?.title ?? "Add a project first"}</option>
            {projects.map((item) => (
              <option
                key={`${item.environmentId}:${item.id}`}
                value={`${item.environmentId}:${item.id}`}
              >
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {similar.length > 0 && (
          <div>
            <p>Related active work. Consider continuing it:</p>
            {similar.map((thread) => (
              <ThreadPreview key={keyFor(thread)} thread={thread} onOpen={onClose} />
            ))}
          </div>
        )}
        <p className={styles["nima-subtle"]}>
          Your objective opens in the real agent composer. Choose a provider and send it to begin
          execution.
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className={styles["nima-action"] + " " + styles["primary"]}
          disabled={busy || !project}
        >
          {busy ? "Opening…" : "Open focus session"}
          <ArrowUpRight size={15} />
        </button>
      </form>
    </NimaDialog>
  );
}
