import { useEffect, useRef, useState, type ReactNode } from "react";
import { BotAvatar } from "./BotAvatar";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { BotProfile } from "@t3tools/contracts";
import {
  Bell,
  BookOpen,
  Bot,
  ChevronDown,
  CircleUserRound,
  Folder,
  Inbox,
  Plus,
  Search,
  Settings,
  Target,
  Shapes,
} from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { openCommandPalette } from "../commandPaletteBus";
import { isMacPlatform } from "../lib/utils";
import { useVisibleThreadShells } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useBots, useOpenBotConversation } from "./useBots";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { botActivity, needsYouReason, threadWorkState, WORK_STATE_LABEL } from "./workState";
import { useNimaStore } from "./store";
import { sortByWorkState, useWorkspaceThreads, WorkStateDot } from "./Workspace";
import { useLiveActivity } from "./studio/liveActivity";
import styles from "./nima.module.css";

const HEADER_BOT_LIMIT = 5;
// Long enough for the stack to fan out first, so the panel follows the motion.
const HOVER_OPEN_MS = 420;
const HOVER_CLOSE_MS = 180;

function BotFace({ avatar, name, seed }: { avatar: string; name: string; seed?: string }) {
  return (
    <span className={styles["bara-bot-face"]} aria-hidden>
      <BotAvatar avatar={avatar} name={name} seed={seed} fill />
    </span>
  );
}

function useBotActivity() {
  const threads = useVisibleThreadShells();
  const review = useWorkspaceReview();
  return (bot: BotProfile, environmentId: string | null) =>
    botActivity({
      bot,
      environmentId,
      threads,
      metaFor: (thread) =>
        review.metadata.get(
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
        ),
    });
}

function BotAvatars() {
  const { bots, environmentId, connected } = useBots();
  const { openConversation, canOpen } = useOpenBotConversation(environmentId);
  const canCreate = useAtomValue(serverEnvironment.createBot.permissionAtom(environmentId));
  const activity = useBotActivity();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const groupRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the hover callback when the Bot group unmounts
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  const hover = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(true, open ? 0 : HOVER_OPEN_MS);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(false, HOVER_CLOSE_MS);
    },
  };
  const team = bots.filter((bot) => !bot.home && !bot.archived);
  const shown = team.slice(0, HEADER_BOT_LIMIT);
  const overflow = team.length - shown.length;
  const reachable = (bot: BotProfile) => connected && (canOpen || bot.threadId !== null);
  const choose = async (bot: BotProfile) => {
    setOpen(false);
    setError("");
    const failure = await openConversation(bot);
    if (failure) setError(failure);
  };
  if (!environmentId) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        window.clearTimeout(timer.current);
        setOpen(next);
      }}
    >
      <div
        ref={groupRef}
        className={styles["bara-bot-group"]}
        role="group"
        aria-label="Bots"
        {...hover}
      >
        {shown.map((bot, index) => {
          const now = activity(bot, environmentId);
          return (
            <button
              key={bot.id}
              type="button"
              className={styles["bara-bot-avatar"]}
              style={{ "--i": index } as React.CSSProperties}
              aria-label={`Open ${bot.config.name}${now ? `, ${now.text}` : ""}`}
              disabled={!reachable(bot)}
              onClick={() => void choose(bot)}
            >
              <BotFace avatar={bot.config.avatar} name={bot.config.name} seed={bot.id} />
              {now && <span className={styles["bara-bot-presence"]} data-work-state={now.state} />}
            </button>
          );
        })}
        <PopoverTrigger
          render={
            <button
              type="button"
              className={styles["bara-bot-more"]}
              aria-label={team.length ? "Show all Bots" : "Bots"}
            />
          }
        >
          {overflow > 0 ? (
            <span data-bot-count="wide">+{overflow}</span>
          ) : (
            <ChevronDown size={14} data-bot-count="wide" />
          )}
          {team.length > 0 && <span data-bot-count="narrow">{team.length}</span>}
        </PopoverTrigger>
      </div>
      <PopoverPopup
        anchor={groupRef}
        align="end"
        sideOffset={10}
        padding="none"
        initialFocus={(type) => type === "keyboard"}
        finalFocus={(type) => type === "keyboard"}
        {...hover}
      >
        <div className={styles["bara-bot-panel"]}>
          <header>
            <h2>My Bots</h2>
            <Link to="/bots" onClick={() => setOpen(false)}>
              Manage
            </Link>
          </header>
          {team.length === 0 && <p>No Bots yet. Create a teammate for work you repeat.</p>}
          <ul>
            {team.map((bot) => {
              const now = activity(bot, environmentId);
              return (
                <li key={bot.id}>
                  <button type="button" disabled={!reachable(bot)} onClick={() => void choose(bot)}>
                    <BotFace avatar={bot.config.avatar} name={bot.config.name} seed={bot.id} />
                    <span>
                      <strong>{bot.config.name}</strong>
                      <small>{bot.config.description}</small>
                      {now && (
                        <small data-work-state={now.state}>
                          <span className={styles["bara-bot-presence-dot"]} aria-hidden />
                          {now.text}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p role="alert">{error}</p>}
          {canCreate && (
            <Link
              to="/bots"
              search={{ create: true }}
              className={styles["bara-bot-create"]}
              onClick={() => setOpen(false)}
            >
              <Plus size={14} /> Create Bot
            </Link>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ProfileMenu() {
  const item = (
    to: "/goals" | "/spaces" | "/studio" | "/inbox",
    icon: ReactNode,
    label: string,
  ) => (
    <MenuItem render={<Link to={to} />}>
      {icon}
      {label}
    </MenuItem>
  );
  return (
    <Menu>
      <MenuTrigger
        render={
          <button className={styles["bara-topbar-profile"]} aria-label="Account and apps">
            <CircleUserRound size={20} />
          </button>
        }
      />
      <MenuPopup side="bottom" align="end">
        {item("/inbox", <Inbox size={15} />, "Inbox")}
        {item("/goals", <Target size={15} />, "Goals")}
        {item("/spaces", <BookOpen size={15} />, "Library")}
        {item("/studio", <Shapes size={15} />, "Studio")}
        <MenuItem render={<Link to="/bots" />}>
          <Bot size={15} />
          Bots
        </MenuItem>
        <MenuItem render={<Link to="/work" search={{ view: "projects" }} />}>
          <Folder size={15} />
          Projects
        </MenuItem>
        <MenuSeparator />
        <MenuItem render={<Link to="/settings/general" />}>
          <Settings size={15} />
          Settings
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function elapsed(since: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours
    ? `${hours}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`;
}

/** Recording, broadcasting or live sources keep running off-screen; the bar always says so. */
function LiveIndicator() {
  const hosts = Object.values(useLiveActivity((state) => state.hosts));
  const onAir = hosts.find((host) => host.recording || host.broadcast) ?? hosts[0];
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a once-a-second clock for the elapsed recording time, only while on air
  useEffect(() => {
    if (onAir?.since == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [onAir?.since]);
  if (!onAir) return null;
  const label = onAir.broadcast
    ? onAir.recording
      ? "Live · Rec"
      : "Live"
    : onAir.recording
      ? "Rec"
      : "Sources on";
  return (
    <Link
      to="/studio"
      search={{ area: "live", environmentId: onAir.environmentId }}
      className={styles["bara-topbar-live"]}
      data-on-air={onAir.recording || onAir.broadcast || undefined}
      aria-label={
        onAir.broadcast
          ? onAir.recording
            ? "Broadcasting live and recording"
            : "Broadcasting live"
          : onAir.recording
            ? "Recording"
            : "Live sources on"
      }
    >
      <span aria-hidden className="motion-safe:animate-status-pulse" />
      {label}
      {onAir.since !== null && <time>{elapsed(onAir.since, Math.max(now, onAir.since))}</time>}
    </Link>
  );
}

const WORK_INDICATOR_LIMIT = 6;

/** What your work is doing right now; hover lists it, click opens the Desk. */
function WorkIndicator() {
  const { active, review } = useWorkspaceThreads();
  const focus = useNimaStore((state) => state.focus);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels the hover callback when the work indicator unmounts
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  const hover = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(true, open ? 0 : HOVER_OPEN_MS);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") schedule(false, HOVER_CLOSE_MS);
    },
  };
  const sessions = sortByWorkState(
    active.map((thread) => {
      const key = scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
      const meta = review.metadata.get(key);
      return {
        thread,
        key,
        title: meta?.title || focus[key]?.title || thread.title,
        state: threadWorkState(thread, Boolean(meta?.assistantWorkPending || meta?.workPending)),
      };
    }),
    (session) => session.state,
  );
  const needsYou = sessions.filter((session) => session.state === "needs-you").length;
  const working = sessions.filter(
    (session) => session.state === "working" || session.state === "queued",
  ).length;
  const state = needsYou ? "needs-you" : working ? "working" : null;
  if (!state) return null;
  const text = [
    needsYou && `${needsYou} need${needsYou === 1 ? "s" : ""} you`,
    working && `${working} working`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Popover
      open={open && sessions.length > 0}
      onOpenChange={(next) => {
        window.clearTimeout(timer.current);
        setOpen(next);
      }}
    >
      <Link
        ref={anchor}
        to="/work"
        className={styles["bara-work-indicator"]}
        data-work-state={state}
        aria-label={`Work: ${text}`}
        viewTransition
        {...hover}
      >
        <span
          aria-hidden
          className={state === "working" ? "motion-safe:animate-status-pulse" : undefined}
        />
        {text}
      </Link>
      <PopoverPopup
        anchor={anchor}
        align="center"
        sideOffset={10}
        padding="none"
        initialFocus={false}
        finalFocus={false}
        {...hover}
      >
        <div className={styles["bara-work-panel"]}>
          <ul>
            {sessions.slice(0, WORK_INDICATOR_LIMIT).map(({ thread, key, title, state }) => (
              <li key={key}>
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: thread.environmentId, threadId: thread.id }}
                  onClick={() => setOpen(false)}
                >
                  <WorkStateDot state={state} />
                  <span>{title}</span>
                  <small>
                    {state === "needs-you" ? needsYouReason(thread) : WORK_STATE_LABEL[state]}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/work" className={styles["bara-bot-create"]} onClick={() => setOpen(false)}>
            Open Desk{sessions.length > WORK_INDICATOR_LIMIT ? ` · ${sessions.length}` : ""}
          </Link>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Bara's global bar: your Assistant, your Desk, teammates, search, attention and account. */
export function BaraTopBar({
  inboxWaiting,
  needsYou,
  children,
}: {
  inboxWaiting: boolean;
  needsYou: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <Link to="/work" className={styles["bara-topbar-brand"]} aria-label="Bara, your Desk">
        bara<span>.</span>
      </Link>
      <nav className={styles["bara-topbar-nav"]} aria-label="Bara">
        <WorkIndicator />
        <LiveIndicator />
      </nav>
      <div className={styles["bara-topbar-tools"]}>
        <BotAvatars />
        <button
          className={styles["bara-topbar-search"]}
          aria-label="Search or run a command"
          onClick={() => openCommandPalette()}
        >
          <Search size={15} />
          <span>Search or run a command…</span>
          <kbd>{isMacPlatform(navigator.platform) ? "⌘ K" : "Ctrl K"}</kbd>
        </button>
        <Link
          to="/inbox"
          className={styles["bara-topbar-bell"]}
          aria-label={inboxWaiting ? "Inbox, items waiting" : "Inbox"}
          data-attention={needsYou || undefined}
        >
          <Bell size={17} />
          {inboxWaiting && <span aria-hidden />}
        </Link>
        <ProfileMenu />
        {children}
      </div>
    </>
  );
}
