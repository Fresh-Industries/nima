import { Link, useLocation } from "@tanstack/react-router";
import { Popover } from "@base-ui/react/popover";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  BookOpen,
  Bot,
  Check,
  Folder,
  Inbox,
  Layers,
  Plus,
  Radio,
  Settings,
  Shapes,
  Target,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { renderClosingPositioner } from "../components/ui/closing-positioner";
import { useLiveActivity } from "./studio/liveActivity";
import { isRichTextBoldShortcut } from "../keybindings";
import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";
import { useWorkspaceThreads } from "./Workspace";
import { threadWorkState } from "./workState";
import styles from "./BaraDock.module.css";

type ItemProps = {
  className: string | undefined;
  "aria-label": string;
  "aria-current": "page" | undefined;
  "data-tool": string;
  onClick: () => void;
  children: ReactNode;
};

const TOOLS: readonly {
  id: string;
  label: string;
  icon: LucideIcon;
  link: (props: ItemProps) => ReactElement;
  matches: (pathname: string, area: string | undefined) => boolean;
}[] = [
  {
    id: "desk",
    label: "Desk",
    icon: Layers,
    link: (props) => <Link to="/work" {...props} />,
    matches: (path) => path === "/work",
  },
  {
    id: "studio",
    label: "Studio",
    icon: Shapes,
    link: (props) => <Link to="/studio" search={{ area: "design" }} {...props} />,
    matches: (path, area) => path === "/studio" && area !== "live",
  },
  {
    id: "live",
    label: "Live",
    icon: Radio,
    link: (props) => <Link to="/studio" search={{ area: "live" }} {...props} />,
    matches: (path, area) => path === "/studio" && area === "live",
  },
  {
    id: "library",
    label: "Library",
    icon: BookOpen,
    link: (props) => <Link to="/spaces" {...props} />,
    matches: (path) => path.startsWith("/spaces"),
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: Inbox,
    link: (props) => <Link to="/inbox" {...props} />,
    matches: (path) => path === "/inbox",
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
const DEFAULT_PINNED = ["desk", "studio", "live", "library"];
const PINNED_KEY = "bara.dock.pinned";
const HIDE_DELAY_MS = 380;

function readPinned(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "null") as unknown;
    if (Array.isArray(saved) && saved.every((id) => typeof id === "string")) return saved;
  } catch {
    // Storage can be unavailable; the default tools still show.
  }
  return DEFAULT_PINNED;
}

/**
 * Bara's tools, hidden off the left edge until the cursor reaches it, like a macOS dock.
 * Keyboard focus reveals it too; touch screens use the account menu instead.
 */
export function BaraDock() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const area = useLocation({
    select: (location) => (location.search as { area?: string }).area,
  });
  const [pinned, setPinned] = useState(readPinned);
  const [revealed, setRevealed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    hideTimer.current = window.setTimeout(() => setRevealed(false), HIDE_DELAY_MS);
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
  return (
    <>
      <div className={styles.edge} aria-hidden onPointerEnter={reveal} />
      <nav
        ref={dockRef}
        className={styles.dock}
        aria-label="Tools"
        data-revealed={revealed || pickerOpen || undefined}
        onPointerEnter={reveal}
        onPointerLeave={() => {
          if (!pickerOpen) conceal();
        }}
      >
        {tools.map(({ id, label, icon: Icon, link, matches }) => {
          const current = matches(pathname, area);
          const status = id === "desk" ? workState : id === "live" && onAir ? "on-air" : null;
          return (
            <Fragment key={id}>
              {link({
                className: `${styles.item} ${styles.tool}`,
                "aria-label": label,
                "aria-current": current ? "page" : undefined,
                "data-tool": id,
                onClick: () => setRevealed(false),
                children: (
                  <>
                    <Icon size={20} strokeWidth={1.7} />
                    <span className={styles.label}>{label}</span>
                    {status && <span className={styles.status} data-status={status} aria-hidden />}
                  </>
                ),
              })}
            </Fragment>
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
            <span className={styles.label}>Add tools</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              side="right"
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
