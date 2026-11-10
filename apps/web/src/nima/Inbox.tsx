import { SaveResultButton } from "./SaveResultButton";
import { BotToolApprovals } from "./BotToolApprovals";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { Link, useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { Bot, Check, Inbox, RotateCcw } from "lucide-react";
import { useState } from "react";
import { inboxSummary } from "./inboxSummary";
import { RelativeTime } from "../components/RelativeTime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { WorkStateDot } from "./Workspace";
import { needsYouReason, threadNeedsYou, threadWorkState, type WorkState } from "./workState";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useThreadActions } from "../hooks/useThreadActions";
import { useVisibleThreadShells } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import type { WorkspaceReviewCursor } from "@t3tools/contracts";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { formatEnvironmentQueryError } from "../state/query";
import styles from "./nima.module.css";

type ReviewItem = ReturnType<typeof useWorkspaceReview>["items"][number];

export function WorkspaceInbox() {
  const [view, setView] = useState<"review" | "settled">("review");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<Record<string, WorkspaceReviewCursor>[]>([{}]);
  const review = useWorkspaceReview(view, pages.at(-1));
  const threads = useVisibleThreadShells();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const write = useAtomCommand(serverEnvironment.writeWorkspaceReview, { reportFailure: false });
  const { unsettleThread } = useThreadActions();
  const navigate = useNavigate();
  const change = async (item: ReviewItem, reopen: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await write({
      environmentId: item.environmentId,
      input: { action: reopen ? "reopen" : "settle", key: item.key, version: item.version },
    });
    if (result._tag !== "Success") setError(formatEnvironmentQueryError(result.cause));
    else if (reopen) {
      if (item.kind === "focus") {
        const resumed = await unsettleThread(scopeThreadRef(item.environmentId, item.threadId));
        if (resumed._tag !== "Success")
          setError("The review was reopened. Open the conversation to resume this session.");
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: item.environmentId, threadId: item.threadId },
      });
    }
    setBusy(false);
  };
  const attention = threads.filter(threadNeedsYou);
  const summary =
    [
      attention.length ? `${attention.length} need${attention.length === 1 ? "s" : ""} you` : "",
      review.pendingCount ? `${review.pendingCount} to review` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "All caught up";
  const items = review.items.filter((item) =>
    `${item.title} ${item.summary}`.toLowerCase().includes(search.toLowerCase()),
  );
  const hasMore = review.hosts.some((host) => host.data?.nextCursor);
  const more = Object.fromEntries(
    review.hosts.flatMap((host) => {
      const last = host.data?.items.at(-1);
      return last ? [[host.environmentId, { at: last.completedAt, key: last.key }]] : [];
    }),
  );
  return (
    <main className={styles["nima-page"]}>
      <header className={styles["nima-page-header"]}>
        <div>
          <h1>Inbox</h1>
          {review.connected && <p>{summary}</p>}
        </div>
      </header>
      <BotToolApprovals settled={view === "settled"} />
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Review status">
          {(["review", "settled"] as const).map((tab) => (
            <Button
              key={tab}
              variant={view === tab ? "secondary" : "ghost"}
              aria-pressed={view === tab}
              onClick={() => {
                setView(tab);
                setPages([{}]);
              }}
            >
              {tab === "review"
                ? `To review${review.pendingCount ? ` · ${review.pendingCount}` : ""}`
                : "Settled"}
            </Button>
          ))}
        </div>
        <div className="w-full sm:w-64">
          <Input
            type="search"
            aria-label="Search Inbox"
            placeholder="Search this page…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {review.errors.map((error) => (
        <p role="alert" key={error}>
          {error}
        </p>
      ))}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!review.connected && (
        <p role="status" className="text-sm text-muted-foreground">
          Reconnect to Bara to review your work.
        </p>
      )}
      {view === "review" && attention.length > 0 && (
        <section aria-label="Needs you" className={styles["bara-work-group"]}>
          <h2>
            Needs you
            <span>{attention.length}</span>
          </h2>
          {attention
            .filter((thread) => thread.title.toLowerCase().includes(search.toLowerCase()))
            .map((thread) => (
              <Link
                key={`${thread.environmentId}:${thread.id}`}
                to="/$environmentId/$threadId"
                params={{ environmentId: thread.environmentId, threadId: thread.id }}
                className={styles["bara-work-card"]}
                data-work-state="needs-you"
              >
                <WorkStateDot state="needs-you" />
                <span>
                  <h3>{thread.title}</h3>
                  <small>
                    <span data-work-state="needs-you">{needsYouReason(thread)}</span>
                  </small>
                </span>
                <span className={styles["bara-card-cta"]}>Respond →</span>
              </Link>
            ))}
        </section>
      )}
      <section
        aria-label={view === "review" ? "Results to review" : "Settled results"}
        className={styles["bara-work-group"]}
      >
        {view === "review" && items.length > 0 && (
          <h2>
            Ready to review
            <span>{review.pendingCount || items.length}</span>
          </h2>
        )}
        {items.map((item) => (
          <ReviewRow
            key={`${item.environmentId}:${item.key}`}
            item={item}
            thread={threads.find(
              (thread) =>
                thread.environmentId === item.environmentId && thread.id === item.threadId,
            )}
            busy={busy}
            onChange={() => void change(item, item.state === "settled")}
          />
        ))}
      </section>
      {review.loading && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          Loading your Inbox…
        </p>
      )}
      {!review.loading &&
        review.connected &&
        !review.errors.length &&
        !items.length &&
        !review.pendingCount &&
        !(view === "review" && attention.length) && (
          <div className={styles["nima-empty"]}>
            <span>
              <Inbox size={26} />
            </span>
            <h2>
              {search
                ? "No matching results"
                : view === "settled"
                  ? "No settled work yet."
                  : "You’re all caught up."}
            </h2>
            <p>
              {view === "review"
                ? "Completed Focus sessions and bot runs appear here."
                : "Results you’ve reviewed stay here until you reopen them."}
            </p>
          </div>
        )}
      <div className="mt-6 flex justify-end gap-2">
        {pages.length > 1 && (
          <Button variant="ghost" onClick={() => setPages((previous) => previous.slice(0, -1))}>
            Newer
          </Button>
        )}
        {hasMore && (
          <Button
            variant="ghost"
            onClick={() => setPages((previous) => [...previous, { ...previous.at(-1), ...more }])}
          >
            Older
          </Button>
        )}
      </div>
    </main>
  );
}

function ReviewRow({
  item,
  thread,
  busy,
  onChange,
}: {
  item: ReviewItem;
  thread: EnvironmentThreadShell | undefined;
  busy: boolean;
  onChange: () => void;
}) {
  const summary = inboxSummary(item.summary);
  const running = Boolean(
    thread &&
    (threadRuntimeIsActive(thread.runtime) ||
      backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)),
  );
  const needsInput = Boolean(thread && threadNeedsYou(thread));
  const state: WorkState =
    item.state === "settled"
      ? "ready"
      : thread
        ? threadWorkState(thread, running)
        : item.status && item.status !== "completed"
          ? "stopped"
          : "ready";
  return (
    <article
      className={styles["bara-review-card"]}
      data-work-state={state}
      data-settled={item.state === "settled" || undefined}
    >
      <WorkStateDot state={state} />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: item.environmentId, threadId: item.threadId }}
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {item.kind === "bot" && <Bot size={13} />}
            {item.kind === "bot" ? "Routine run" : "Focus session"}
            <span>·</span>
            <Tooltip>
              <TooltipTrigger render={<time dateTime={item.completedAt} />}>
                <RelativeTime timestamp={item.completedAt} />
              </TooltipTrigger>
              <TooltipPopup side="top">
                {new Date(item.completedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </TooltipPopup>
            </Tooltip>
            {item.status && item.status !== "completed" && <span>· {item.status}</span>}
          </span>
          <h3 className="text-base font-medium">{item.title}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {summary || "Open the conversation to review the result."}
          </p>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          disabled={!item.canWrite || busy || (item.kind === "focus" && (running || needsInput))}
          onClick={onChange}
        >
          {item.state === "settled" ? <RotateCcw /> : <Check />}
          {item.state === "settled" ? "Reopen" : "Settle"}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
        {item.runId && (
          <SaveResultButton
            key={item.version}
            environmentId={item.environmentId}
            threadId={item.threadId}
            runId={item.runId}
            title={item.title}
          />
        )}
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: item.environmentId, threadId: item.threadId }}
          className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          Read full result & reply →
        </Link>
        {item.goalId && (
          <Link
            to="/goals"
            search={{ goalId: item.goalId, environmentId: item.environmentId }}
            className="text-muted-foreground hover:text-foreground"
          >
            View goal
          </Link>
        )}
        {item.kind === "bot" && (
          <Link
            to="/bots"
            search={{
              environmentId: item.environmentId,
              ...(item.botId ? { taskId: item.botId } : {}),
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            View routine
          </Link>
        )}
        {item.kind === "focus" && running && (
          <span className="text-muted-foreground">Work is continuing</span>
        )}
      </div>
    </article>
  );
}
