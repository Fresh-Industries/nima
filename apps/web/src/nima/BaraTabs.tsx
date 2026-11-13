import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { PUCKO_HOME_THREAD_ID, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Bot,
  Layers,
  MessageSquare,
  Shapes,
  Smile,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useVisibleThreadShells } from "../state/entities";
import { BotAvatar } from "./BotAvatar";
import { useTabsStore, type WorkspaceTab } from "./tabsStore";
import { useBots } from "./useBots";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { WorkStateDot } from "./Workspace";
import { threadWorkState } from "./workState";
import styles from "./BaraTabs.module.css";

type AppTab = {
  label: string;
  icon: LucideIcon;
  matches: (pathname: string) => boolean;
  link: (props: { className: string | undefined; children: ReactNode }) => ReactNode;
};
// The Desk is always the first tab; these open as you visit them.
const APPS: Record<string, AppTab> = {
  studio: {
    label: "Studio",
    icon: Shapes,
    matches: (path) => path === "/studio",
    link: (props) => <Link to="/studio" {...props} />,
  },
  library: {
    label: "Library",
    icon: BookOpen,
    matches: (path) => path.startsWith("/spaces"),
    link: (props) => <Link to="/spaces" {...props} />,
  },
  goals: {
    label: "Goals",
    icon: Target,
    matches: (path) => path.startsWith("/goals"),
    link: (props) => <Link to="/goals" {...props} />,
  },
  bots: {
    label: "Bots",
    icon: Bot,
    matches: (path) => path === "/bots",
    link: (props) => <Link to="/bots" {...props} />,
  },
  pucko: {
    label: "Pucko",
    icon: Smile,
    matches: (path) => path === "/pucko",
    link: (props) => <Link to="/pucko" {...props} />,
  },
};

/** Chrome-style tabs for what you have open: the Desk, then conversations and apps. */
export function BaraTabs() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const target = useThreadRouteTarget();
  const ref = target?.kind === "server" ? target.threadRef : null;
  const threads = useVisibleThreadShells();
  const review = useWorkspaceReview();
  const assistant = usePersonalAssistant();
  const { bots } = useBots();
  const tabs = useTabsStore((state) => state.tabs);
  const describe = (environmentId: EnvironmentId, threadId: ThreadId) => {
    const thread = threads.find(
      (entry) => entry.environmentId === environmentId && entry.id === threadId,
    );
    const bot = bots.find((entry) => entry.threadId === threadId);
    const isAssistant = assistant.profile?.threadId === threadId;
    const meta = thread
      ? review.metadata.get(scopedThreadKey({ environmentId: thread.environmentId, threadId }))
      : undefined;
    return {
      thread,
      title: isAssistant
        ? assistant.config.name
        : bot
          ? bot.config.name
          : threadId === PUCKO_HOME_THREAD_ID
            ? "Pucko"
            : meta?.title || thread?.title,
      face: isAssistant
        ? { avatar: assistant.config.avatar, name: assistant.config.name, seed: undefined }
        : bot
          ? { avatar: bot.config.avatar, name: bot.config.name, seed: bot.id }
          : null,
      state:
        thread && !isAssistant && !bot
          ? threadWorkState(thread, Boolean(meta?.assistantWorkPending || meta?.workPending))
          : null,
    };
  };
  const app = Object.entries(APPS).find(([, entry]) => entry.matches(pathname))?.[0];
  const currentId = ref ? `thread:${scopedThreadKey(ref)}` : app ? `app:${app}` : null;
  const currentTitle = ref ? describe(ref.environmentId, ref.threadId).title : undefined;
  const environmentId = ref?.environmentId;
  const threadId = ref?.threadId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the page the router is showing as an open tab in the persisted tab list
  useEffect(() => {
    if (!currentId) return;
    if (environmentId && threadId) {
      if (currentTitle)
        useTabsStore.getState().open({
          id: currentId,
          kind: "thread",
          environmentId,
          threadId,
          title: currentTitle,
        });
    } else if (app) useTabsStore.getState().open({ id: currentId, kind: "app", app });
  }, [currentId, currentTitle, app, environmentId, threadId]);
  const close = (tab: WorkspaceTab) => {
    const at = tabs.findIndex((entry) => entry.id === tab.id);
    useTabsStore.getState().close(tab.id);
    if (tab.id !== currentId) return;
    const next = tabs[at + 1] ?? tabs[at - 1];
    if (next?.kind === "thread")
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.threadId },
      });
    else void navigate({ to: "/work" });
  };
  const onDesk = pathname === "/work" || pathname === "/inbox";
  return (
    <nav className={styles.tabs} aria-label="Open tabs">
      <Link
        to="/work"
        className={styles.tab}
        data-pinned
        aria-current={onDesk ? "page" : undefined}
      >
        <Layers size={14} />
        <span>Desk</span>
      </Link>
      {tabs.map((tab) => {
        const current = tab.id === currentId;
        const closeButton = (
          <button
            type="button"
            className={styles.close}
            aria-label={`Close ${tab.kind === "thread" ? tab.title : (APPS[tab.app]?.label ?? "tab")}`}
            onClick={() => close(tab)}
          >
            <X size={12} />
          </button>
        );
        const props = {
          className: styles.link,
          onAuxClick: (event: React.MouseEvent) => {
            if (event.button !== 1) return;
            event.preventDefault();
            close(tab);
          },
        };
        if (tab.kind === "app") {
          const entry = APPS[tab.app];
          if (!entry) return null;
          const Icon = entry.icon;
          return (
            <div key={tab.id} className={styles.tab} data-current={current || undefined}>
              {entry.link({
                className: styles.link,
                children: (
                  <>
                    <Icon size={14} />
                    <span>{entry.label}</span>
                  </>
                ),
              })}
              {closeButton}
            </div>
          );
        }
        const { title, face, state } = describe(tab.environmentId, tab.threadId);
        return (
          <div key={tab.id} className={styles.tab} data-current={current || undefined}>
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId: tab.environmentId, threadId: tab.threadId }}
              aria-current={current ? "page" : undefined}
              {...props}
            >
              {face ? (
                <span className={styles.face} aria-hidden>
                  <BotAvatar {...face} fill />
                </span>
              ) : state ? (
                <WorkStateDot state={state} />
              ) : (
                <MessageSquare size={13} />
              )}
              <span>{title ?? tab.title}</span>
            </Link>
            {closeButton}
          </div>
        );
      })}
    </nav>
  );
}
