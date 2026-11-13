import { Link, useLocation } from "@tanstack/react-router";
import { Popover } from "@base-ui/react/popover";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  BookOpen,
  Bot,
  Check,
  Folder,
  Layers,
  Plus,
  Radio,
  Settings,
  Shapes,
  Target,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type ComponentType,
} from "react";
import { renderClosingPositioner } from "../components/ui/closing-positioner";
import { useLiveActivity } from "./studio/liveActivity";
import { isRichTextBoldShortcut } from "../keybindings";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { useWorkspaceThreads } from "./Workspace";
import { useNimaStore } from "./store";
import { threadWorkState } from "./workState";
import styles from "./BaraDock.module.css";

type ActionProps = { className: string | undefined; onClick: () => void };
type Edge = "left" | "bottom" | "right";
const EDGE_KEY = "bara.dock.edge";
// Pointer travel before a press on the dock becomes a drag instead of a click.
const DRAG_THRESHOLD = 8;
const RECENT_LIMIT = 3;

function readEdge(): Edge {
  try {
    const saved = localStorage.getItem(EDGE_KEY);
    if (saved === "left" || saved === "bottom" || saved === "right") return saved;
  } catch {
    // Storage can be unavailable; the dock still works on the left.
  }
  return "left";
}

type ItemProps = {
  className: string | undefined;
  "aria-label": string;
  "aria-current": "page" | undefined;
  "data-tool": string;
  onClick: () => void;
  children: ReactNode;
};

function PuckoIcon({ size = 20 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <path d="M7 8v3m10-3v3m-8 5q3 3 6 0" strokeLinecap="round" />
      <rect x="2" y="3" width="20" height="18" rx="7" />
    </svg>
  );
}

const TOOLS: readonly {
  id: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  link: (props: ItemProps) => ReactElement;
  matches: (pathname: string, area: string | undefined) => boolean;
  /** Shortcuts shown when the tool is hovered. */
  actions?: readonly ((props: ActionProps) => ReactElement)[];
}[] = [
  {
    id: "pucko",
    label: "Pucko",
    icon: PuckoIcon,
    link: (props) => <Link to="/pucko" {...props} />,
    matches: (path) => path === "/pucko",
    actions: [
      (props) => (
        <Link to="/pucko" {...props}>
          Talk or start a meeting
        </Link>
      ),
    ],
  },
  {
    id: "desk",
    label: "Desk",
    icon: Layers,
    link: (props) => <Link to="/work" {...props} />,
    matches: (path) => path === "/work" || path === "/inbox",
    actions: [
      (props) => (
        <Link to="/work" search={{ new: true }} {...props}>
          New session
        </Link>
      ),
      (props) => (
        <Link to="/inbox" {...props}>
          To review
        </Link>
      ),
      (props) => (
        <Link to="/work" search={{ view: "projects" }} {...props}>
          Projects
        </Link>
      ),
    ],
  },
  {
    id: "studio",
    label: "Studio",
    icon: Shapes,
    link: (props) => <Link to="/studio" search={{ area: "design" }} {...props} />,
    matches: (path, area) => path === "/studio" && area !== "live",
    actions: [
      (props) => (
        <Link to="/studio" search={{ area: "design" }} {...props}>
          Open a design
        </Link>
      ),
    ],
  },
  {
    id: "live",
    label: "Live",
    icon: Radio,
    link: (props) => <Link to="/studio" search={{ area: "live" }} {...props} />,
    matches: (path, area) => path === "/studio" && area === "live",
    actions: [
      (props) => (
        <Link to="/studio" search={{ area: "live" }} {...props}>
          Record or go live
        </Link>
      ),
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: BookOpen,
    link: (props) => <Link to="/spaces" {...props} />,
    matches: (path) => path.startsWith("/spaces"),
  },
  {
    id: "goals",
    label: "Goals",
    icon: Target,
    link: (props) => <Link to="/goals" {...props} />,
    matches: (path) => path.startsWith("/goals"),
  },
  {
    id: "bots",
    label: "Bots",
    icon: Bot,
    link: (props) => <Link to="/bots" {...props} />,
    matches: (path) => path === "/bots",
    actions: [
      (props) => (
        <Link to="/bots" search={{ create: true }} {...props}>
          Create a Bot
        </Link>
      ),
    ],
  },
  {
    id: "projects",
    label: "Projects",
    icon: Folder,
    link: (props) => <Link to="/work" search={{ view: "projects" }} {...props} />,
    matches: () => false,
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    link: (props) => <Link to="/settings/general" {...props} />,
    matches: (path) => path.startsWith("/settings"),
  },
];
const DEFAULT_PINNED = ["pucko", "desk", "studio", "live", "library"];
const PINNED_KEY = "bara.dock.pinned";
const HIDE_DELAY_MS = 380;
const DROP_HOLD_MS = 1600;

function readPinned(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "null") as unknown;
    if (Array.isArray(saved) && saved.every((id) => typeof id === "string")) {
      if (localStorage.getItem("bara.dock.pucko-added") === "1") return saved;
      const next = saved.includes("pucko") ? saved : ["pucko", ...saved];
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
      localStorage.setItem("bara.dock.pucko-added", "1");
      return next;
    }
    localStorage.setItem("bara.dock.pucko-added", "1");
  } catch {
    // Storage can be unavailable; the default tools still show.
  }
  return DEFAULT_PINNED;
}

/**
 * Bara's tools, hidden off an edge of the window until the cursor reaches it, like a macOS dock.
 * Drag it to the left, bottom or right edge. Hovering a tool shows its shortcuts. Keyboard focus
 * reveals it too; touch screens use the account menu instead.
 */
export function BaraDock() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const area = useLocation({
    select: (location) => (location.search as { area?: string }).area,
  });
  const [pinned, setPinned] = useState(readPinned);
  const [revealed, setRevealed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [edge, setEdge] = useState(readEdge);
  const dragged = useRef(false);
  const holdUntil = useRef(0);
  // The dock follows the pointer directly and commits its edge once, on release. The window
  // listens for the move so a fast drag that leaves the dock is still followed.
  const dragHandlers = {
    onPointerDown: (down: React.PointerEvent<HTMLElement>) => {
      const dock = dockRef.current;
      if (down.button !== 0 || !dock) return;
      dragged.current = false;
      const move = (event: PointerEvent) => {
        const dx = event.clientX - down.clientX;
        const dy = event.clientY - down.clientY;
        if (!dragged.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragged.current = true;
        dock.dataset.dragging = "";
        dock.style.setProperty("--drag-x", `${dx}px`);
        dock.style.setProperty("--drag-y", `${dy}px`);
        window.getSelection()?.removeAllRanges();
      };
      const up = (event: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!dragged.current) return;
        delete dock.dataset.dragging;
        dock.style.removeProperty("--drag-x");
        dock.style.removeProperty("--drag-y");
        if (event.type === "pointercancel") return;
        const x = event.clientX / window.innerWidth;
        const next: Edge =
          event.clientY / window.innerHeight > 0.7 && x > 0.2 && x < 0.8
            ? "bottom"
            : x > 0.5
              ? "right"
              : "left";
        setEdge(next);
        // The dock lands away from the pointer; it stays out long enough to be seen there.
        holdUntil.current = performance.now() + DROP_HOLD_MS;
        reveal();
        conceal();
        try {
          localStorage.setItem(EDGE_KEY, next);
        } catch {
          // Only a per-viewer convenience.
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    // A drag that ends over a tool must not also open it.
    onClickCapture: (event: React.MouseEvent) => {
      if (!dragged.current) return;
      dragged.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
  };
  const dockRef = useRef<HTMLElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the pending hide callback when the dock unmounts
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the existing sidebar shortcut and desktop menu action connected to workspace navigation
  useEffect(() => {
    const toggle = () => {
      window.clearTimeout(hideTimer.current);
      setRevealed((current) => !current);
    };
    const unregister = registerCommands(
      {
        "sidebar.toggle": (event) => {
          if (
            event.target instanceof HTMLElement &&
            (event.target.closest("[data-keybinding-capture]") ||
              (event.target.closest('[data-composer-rich-text="true"]') &&
                isRichTextBoldShortcut(event, window.getSelection())))
          )
            return false;
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
      },
      { capture: true },
    );
    const unregisterMenu = registerMenuAction("sidebar.toggle", toggle);
    return () => {
      unregister();
      unregisterMenu();
    };
  }, []);
  const onAir = Object.values(useLiveActivity((state) => state.hosts)).some(
    (host) => host.recording || host.broadcast,
  );
  const { active, review } = useWorkspaceThreads();
  const states = active.map((thread) => {
    const meta = review.metadata.get(
      scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
    );
    return threadWorkState(thread, Boolean(meta?.assistantWorkPending || meta?.workPending));
  });
  const workState = states.includes("needs-you")
    ? "needs-you"
    : states.some((state) => state === "working" || state === "queued")
      ? "working"
      : null;
  const reveal = () => {
    window.clearTimeout(hideTimer.current);
    setRevealed(true);
  };
  const conceal = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(
      () => setRevealed(false),
      Math.max(HIDE_DELAY_MS, holdUntil.current - performance.now()),
    );
  };
  const toggle = (id: string, on: boolean) => {
    const next = on
      ? TOOLS.map((tool) => tool.id).filter((tool) => tool === id || pinned.includes(tool))
      : pinned.filter((tool) => tool !== id);
    setPinned(next);
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    } catch {
      // Only a per-viewer convenience.
    }
  };
  const tools = TOOLS.filter((tool) => pinned.includes(tool.id));
  const focus = useNimaStore((state) => state.focus);
  const recent = [...active]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
  const action = { className: styles.action, onClick: () => setRevealed(false) };
  return (
    <>
      <div className={styles.edge} data-edge={edge} aria-hidden onPointerEnter={reveal} />
      <nav
        ref={dockRef}
        className={styles.dock}
        aria-label="Tools"
        data-edge={edge}
        {...dragHandlers}
        data-revealed={revealed || pickerOpen || undefined}
        onPointerEnter={reveal}
        onPointerLeave={() => {
          if (!pickerOpen) conceal();
        }}
      >
        {tools.map(({ id, label, icon: Icon, link, matches, actions }) => {
          const current = matches(pathname, area);
          const status = id === "desk" ? workState : id === "live" && onAir ? "on-air" : null;
          return (
            <div key={id} className={`${styles.slot} ${styles.tool}`} data-tool={id}>
              {link({
                className: styles.item,
                "aria-label": label,
                "aria-current": current ? "page" : undefined,
                "data-tool": id,
                onClick: () => setRevealed(false),
                children: (
                  <>
                    <Icon size={20} strokeWidth={1.7} />
                    {status && <span className={styles.status} data-status={status} aria-hidden />}
                  </>
                ),
              })}
              <div className={styles.flyout}>
                <strong>{label}</strong>
                {actions?.map((render, index) => (
                  // oxlint-disable-next-line react/no-array-index-key -- a fixed list per tool
                  <Fragment key={index}>{render(action)}</Fragment>
                ))}
                {id === "desk" && recent.length > 0 && (
                  <>
                    <small>Recent</small>
                    {recent.map((thread) => {
                      const key = scopedThreadKey({
                        environmentId: thread.environmentId,
                        threadId: thread.id,
                      });
                      return (
                        <Link
                          key={key}
                          to="/$environmentId/$threadId"
                          params={{ environmentId: thread.environmentId, threadId: thread.id }}
                          {...action}
                        >
                          {review.metadata.get(key)?.title || focus[key]?.title || thread.title}
                        </Link>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })}
        <span className={styles.divider} role="separator" />
        <Popover.Root
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open);
            window.clearTimeout(hideTimer.current);
            if (!open) conceal();
          }}
        >
          <Popover.Trigger className={`${styles.item} ${styles.add}`} aria-label="Customize tools">
            <Plus size={20} strokeWidth={1.7} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              side={edge === "left" ? "right" : edge === "right" ? "left" : "top"}
              align="center"
              anchor={dockRef}
              sideOffset={12}
              collisionPadding={12}
              className={styles.positioner}
              render={renderClosingPositioner}
            >
              <Popover.Popup className={styles.picker}>
                <header className={styles.pickerHeader}>
                  <Popover.Title>Your dock</Popover.Title>
                  <Popover.Description>Pin the tools you use.</Popover.Description>
                </header>
                <div className={styles.toolGrid}>
                  {TOOLS.map(({ id, label, icon: Icon }) => {
                    const selected = pinned.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`${styles.option} ${styles.tool}`}
                        data-tool={id}
                        aria-pressed={selected}
                        onClick={() => toggle(id, !selected)}
                      >
                        <span className={styles.toolFace} aria-hidden>
                          <Icon size={20} strokeWidth={1.7} />
                        </span>
                        <span>{label}</span>
                        {selected && (
                          <span className={styles.pinned} aria-hidden>
                            <Check size={9} strokeWidth={2.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </nav>
    </>
  );
}
