import { Link } from "@tanstack/react-router";
import { History, Image, Inbox, Plus } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { sortByWorkState, useWorkspaceThreads, WorkStateDot } from "./Workspace";
import { needsYouReason, threadWorkState, WORK_STATE_LABEL } from "./workState";
import { useNimaStore } from "./store";
import { useDay } from "./useDay";
import styles from "./WorkspaceHome.module.css";

const IN_PROGRESS_LIMIT = 3;

export function AssistantWelcome() {
  const {
    config: { name, avatar },
  } = usePersonalAssistant();
  return (
    <div className={styles.welcome}>
      <span className={styles.avatar} role="img" aria-label={name}>
        {avatar}
      </span>
      <h1>What are we working on?</h1>
      <p>Ask, create, plan, or hand something off to Bara.</p>
    </div>
  );
}

/** A quiet start to today's conversation once Home has stepped aside. */
export function AssistantFocusEmpty() {
  const {
    config: { name, avatar },
  } = usePersonalAssistant();
  const day = useDay();
  return (
    <div className={styles.focusEmpty}>
      <span className={styles.avatar} aria-hidden="true">
        {avatar}
      </span>
      <p>{name}</p>
      <small>
        {new Intl.DateTimeFormat(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${day}T12:00:00Z`))}
      </small>
    </div>
  );
}

/** Quick actions and live Work sessions under the Home composer. */
export function AssistantStartActions() {
  const { active, review } = useWorkspaceThreads();
  const focus = useNimaStore((state) => state.focus);
  const sessions = active.map((thread) => {
    const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
    const meta = review.metadata.get(key);
    return {
      thread,
      key,
      state: threadWorkState(thread, Boolean(meta?.assistantWorkPending || meta?.workPending)),
      title: meta?.title || focus[key]?.title || thread.title,
      detail:
        meta?.objective || focus[key]?.objective || thread.source.latestVisibleMessage?.text || "",
    };
  });
  const byRecent = [...sessions].sort((a, b) =>
    b.thread.updatedAt.localeCompare(a.thread.updatedAt),
  );
  const recent = byRecent[0];
  const inProgress = sortByWorkState(byRecent, (session) => session.state).slice(
    0,
    IN_PROGRESS_LIMIT,
  );
  return (
    <div className={styles.belowComposer} data-bara-home-actions>
      <nav className={styles.actions} aria-label="Quick actions">
        <Link to="/work" search={{ new: true }}>
          <Plus size={16} strokeWidth={1.6} /> Start new work
        </Link>
        {recent && (
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: recent.thread.environmentId, threadId: recent.thread.id }}
          >
            <History size={16} strokeWidth={1.6} /> Continue recent
          </Link>
        )}
        <Link to="/studio" search={{ area: "design" }}>
          <Image size={16} strokeWidth={1.6} /> Open Studio
        </Link>
        <Link to="/inbox">
          <Inbox size={16} strokeWidth={1.6} /> Check inbox
        </Link>
      </nav>
      {inProgress.length > 0 && (
        <section className={styles.progress} aria-labelledby="bara-home-progress">
          <h2 id="bara-home-progress">In progress</h2>
          <ul>
            {inProgress.map(({ thread, key, state, title, detail }) => (
              <li key={key}>
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: thread.environmentId, threadId: thread.id }}
                  data-work-state={state}
                >
                  <WorkStateDot state={state} />
                  <span>
                    <strong>{title}</strong>
                    <small>
                      {state === "needs-you"
                        ? needsYouReason(thread)
                        : detail || WORK_STATE_LABEL[state]}
                    </small>
                  </span>
                  <span className="sr-only">{WORK_STATE_LABEL[state]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
