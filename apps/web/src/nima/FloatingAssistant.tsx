import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { Maximize2, Minus } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import ChatView from "../components/ChatView";
import { BackgroundThreadContext } from "../components/chat/backgroundThread";
import { ComposerHandleContext } from "../composerHandleContext";
import { observeResize } from "../lib/observeResize";
import { useVisibleThreadShells } from "../state/entities";
import { BotAvatar } from "./BotAvatar";
import { useAssistantThread } from "./useAssistantThread";
import { markSessionTransition } from "./Workspace";
import styles from "./FloatingAssistant.module.css";

const POSITION_KEY = "bara.floatingAssistant.position";
const EDGE = 8;
// Movement before a press on the face counts as a drag rather than a click.
const DRAG_THRESHOLD = 4;

type Position = { right: number; bottom: number };

function readPosition(): Position {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as Position | null;
    if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) return saved;
  } catch {
    // Storage can be unavailable; the default corner still works.
  }
  return { right: 20, bottom: 20 };
}

function savePosition(position: Position) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // Only a per-viewer convenience.
  }
}

function constrainPosition(position: Position, element: HTMLElement) {
  const topbar =
    Number.parseFloat(getComputedStyle(element).getPropertyValue("--workspace-topbar-height")) ||
    52;
  return {
    right: Math.max(EDGE, Math.min(position.right, window.innerWidth - element.offsetWidth - EDGE)),
    bottom: Math.max(
      EDGE,
      Math.min(position.bottom, window.innerHeight - element.offsetHeight - topbar - EDGE),
    ),
  };
}

/**
 * Your Assistant as a window you can drag anywhere: a face that opens into its real conversation,
 * with a way into full screen. Hidden while the full-screen conversation is the page.
 */
export function FloatingAssistant({ hidden }: { hidden: boolean }) {
  const { assistant, threadRef, error, retry } = useAssistantThread();
  const { name, avatar } = assistant.config;
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const panelRef = useRef<HTMLElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(readPosition);
  const suppressClick = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    from: Position;
    to: Position;
    moved: boolean;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the floating window reachable when its size or the browser viewport changes
  useLayoutEffect(() => {
    if (hidden) return;
    const element = windowRef.current;
    if (!element) return;
    const constrain = () => {
      setPosition((current) => {
        const next = constrainPosition(current, element);
        return next.right === current.right && next.bottom === current.bottom ? current : next;
      });
    };
    constrain();
    const stop = observeResize(element, constrain);
    window.addEventListener("resize", constrain);
    return () => {
      stop();
      window.removeEventListener("resize", constrain);
    };
  }, [hidden]);
  const finishDrag = () => {
    const current = drag.current;
    drag.current = null;
    windowRef.current?.removeAttribute("data-dragging");
    if (current?.moved) {
      suppressClick.current = true;
      setPosition(current.to);
      savePosition(current.to);
    }
  };
  // Dragging moves the window directly and commits once, so the conversation never re-renders mid-drag.
  const dragHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("[data-no-drag]")) return;
      suppressClick.current = false;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        from: position,
        to: position,
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const current = drag.current;
      const element = windowRef.current;
      if (!current || !element) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      current.to = constrainPosition(
        { right: current.from.right - dx, bottom: current.from.bottom - dy },
        element,
      );
      element.style.setProperty("--assistant-right", `${current.to.right}px`);
      element.style.setProperty("--assistant-bottom", `${current.to.bottom}px`);
      element.dataset.dragging = "";
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onLostPointerCapture: finishDrag,
  };
  const working = useVisibleThreadShells().some(
    (thread) =>
      threadRef !== null &&
      thread.environmentId === threadRef.environmentId &&
      thread.id === threadRef.threadId &&
      threadRuntimeIsActive(thread.runtime),
  );
  const fullScreen = () => {
    if (!threadRef) return;
    if (panelRef.current) markSessionTransition(panelRef.current);
    setOpen(false);
    void navigate({
      to: "/$environmentId/$threadId",
      params: threadRef,
      viewTransition: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
  };
  const minimize = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };
  if (hidden) return null;
  // A floating window is too small to chat in on a phone, so the face opens the full conversation.
  const compact = window.matchMedia("(max-width: 640px)").matches;
  return (
    <div
      ref={windowRef}
      className={styles.dock}
      data-side-chat-pane
      data-open={open || undefined}
      style={
        {
          "--assistant-right": `${position.right}px`,
          "--assistant-bottom": `${position.bottom}px`,
        } as React.CSSProperties
      }
    >
      {open && (
        <section
          ref={panelRef}
          className={styles.panel}
          aria-label={`${name}, your Assistant`}
          // Captured: the composer consumes Escape. An open menu or suggestion list keeps it.
          onKeyDownCapture={(event) => {
            if (
              event.key === "Escape" &&
              !document.querySelector('[role="menu"], [role="listbox"], [role="dialog"]')
            )
              minimize();
          }}
        >
          <header {...dragHandlers}>
            <span className={styles.face} aria-hidden>
              <BotAvatar avatar={avatar} name={name} fill />
            </span>
            <strong>{name}</strong>
            {working && <span className={styles.working}>Working</span>}
            <button type="button" aria-label="Open full screen" onClick={fullScreen} data-no-drag>
              <Maximize2 size={14} />
            </button>
            <button type="button" aria-label="Minimize" onClick={minimize} data-no-drag>
              <Minus size={15} />
            </button>
          </header>
          <div className={styles.body}>
            {threadRef ? (
              <BackgroundThreadContext value>
                <ComposerHandleContext value={null}>
                  <ChatView
                    environmentId={threadRef.environmentId}
                    threadId={threadRef.threadId}
                    routeKind="server"
                    embedded={{ openToolDiff: fullScreen, runShellCommand: fullScreen }}
                  />
                </ComposerHandleContext>
              </BackgroundThreadContext>
            ) : (
              <div className={styles.status} role="status">
                <p>
                  {error ||
                    (assistant.connected
                      ? "Opening your conversation…"
                      : "Connecting to your assistant…")}
                </p>
                {error && (
                  <button type="button" onClick={retry}>
                    Try again
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          className={styles.launcher}
          aria-label={`Chat with ${name}`}
          {...dragHandlers}
          onClick={(event) => {
            if (suppressClick.current && event.detail > 0) {
              suppressClick.current = false;
              return;
            }
            if (compact) fullScreen();
            else setOpen(true);
          }}
        >
          <span className={styles.face} aria-hidden>
            <BotAvatar avatar={avatar} name={name} fill />
            {working && <span className={styles.dot} />}
          </span>
          <span className={styles.prompt}>Ask {name}…</span>
        </button>
      )}
    </div>
  );
}
