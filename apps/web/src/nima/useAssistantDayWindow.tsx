import { useEffect, useRef, useState } from "react";
import type { TimelineEntry } from "../session-logic";
import type { MessagesTimelineHistoryControls } from "../components/chat/MessagesTimeline";
import { useDay } from "./useDay";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { dailyTimeline } from "./dailyHistory";

export function useAssistantDayWindow<T extends Pick<TimelineEntry, "id" | "createdAt">>(input: {
  enabled: boolean;
  threadKey: string | null;
  entries: ReadonlyArray<T>;
  history: MessagesTimelineHistoryControls | undefined;
  searching: boolean;
}) {
  const today = useDay();
  const {
    config: { timezone },
  } = usePersonalAssistant();
  const key = `${input.threadKey}:${today}`;
  const requestedPage = useRef("");
  const [window, setWindow] = useState({ key, from: today, pending: false });
  if (window.key !== key) setWindow({ key, from: today, pending: false });
  const from = window.key === key ? window.from : today;
  const filtered = input.enabled
    ? dailyTimeline(input.entries, from, timezone)
    : { entries: input.entries, previous: null, oldest: null };
  if (window.pending && filtered.previous) {
    setWindow({ key, from: filtered.previous, pending: false });
  } else if (window.pending && (input.history?.error || input.history?.hasMoreHistory === false)) {
    setWindow({ ...window, pending: false });
  }
  const page = `${from}:${input.entries[0]?.id ?? "empty"}`;
  const incompleteDay = from !== today && filtered.oldest !== null && filtered.oldest >= from;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- continue server pagination until the requested day boundary is available, deduplicating each loaded page
  useEffect(() => {
    if (
      !input.enabled ||
      input.searching ||
      window.key !== key ||
      input.history?.loading ||
      input.history?.error ||
      !input.history?.hasMoreHistory ||
      requestedPage.current === `${key}:${page}`
    )
      return;
    if (!(window.pending && filtered.previous === null) && !incompleteDay) return;
    requestedPage.current = `${key}:${page}`;
    input.history.onLoadEarlier();
  }, [
    input.enabled,
    input.searching,
    input.history,
    window,
    key,
    page,
    incompleteDay,
    filtered.previous,
  ]);
  const cutoff = input.enabled && !input.searching ? from : null;
  const canReveal = filtered.previous !== null || input.history?.hasMoreHistory;
  const historyHeader =
    input.enabled && !input.searching && canReveal ? (
      <div className="messages-timeline-row-frame relative z-20">
        <div className="chat-content-lane py-4 text-center text-xs text-muted-foreground">
          <button
            className="cursor-pointer rounded-md px-4 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
            disabled={window.pending || input.history?.loading}
            onClick={() => {
              if (filtered.previous) setWindow({ key, from: filtered.previous, pending: false });
              else if (input.history?.hasMoreHistory) {
                setWindow({ key, from, pending: true });
                requestedPage.current = `${key}:${page}`;
                input.history.onLoadEarlier();
              }
            }}
          >
            {window.pending || input.history?.loading
              ? "Loading previous day…"
              : "View previous day"}
          </button>
          {input.history?.error && <p role="status">{input.history.error}</p>}
        </div>
      </div>
    ) : undefined;
  return {
    cutoff,
    timezone,
    today,
    historyHeader,
    entries: cutoff ? filtered.entries : input.entries,
  };
}
