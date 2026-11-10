import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { BotProfile } from "@t3tools/contracts";
import {
  Bell,
  BookOpen,
  ChevronDown,
  CircleUserRound,
  Folder,
  Inbox,
  Layers,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Shapes,
} from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { openCommandPalette } from "../commandPaletteBus";
import { isMacPlatform } from "../lib/utils";
import { useVisibleThreadShells } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { usePersonalAssistant } from "./usePersonalAssistant";
import { useBots, useOpenBotConversation } from "./useBots";
import { useWorkspaceReview } from "./useWorkspaceReview";
import { botActivity } from "./workState";
import styles from "./nima.module.css";

const HEADER_BOT_LIMIT = 3;
const HOVER_OPEN_MS = 280;
const HOVER_CLOSE_MS = 180;

function BotFace({ avatar, name }: { avatar: string; name: string }) {
  return (
    <span className={styles["bara-bot-face"]} aria-hidden>
      {avatar.trim() || name.trim().charAt(0).toUpperCase() || "?"}
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
  const assistant = usePersonalAssistant();
  const { bots, environmentId, connected } = useBots();
  const { openConversation, canOpen } = useOpenBotConversation(environmentId);
  const canCreate = useAtomValue(serverEnvironment.createBot.permissionAtom(environmentId));
  const activity = useBotActivity();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const groupRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
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
        <Link to="/" className={styles["bara-bot-avatar"]} aria-label={assistant.config.name}>
          <BotFace avatar={assistant.config.avatar} name={assistant.config.name} />
        </Link>
        {shown.map((bot) => {
          const now = activity(bot, environmentId);
          return (
            <button
              key={bot.id}
              type="button"
              className={styles["bara-bot-avatar"]}
              aria-label={`Open ${bot.config.name}${now ? `, ${now.text}` : ""}`}
              disabled={!reachable(bot)}
              onClick={() => void choose(bot)}
            >
              <BotFace avatar={bot.config.avatar} name={bot.config.name} />
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
                    <BotFace avatar={bot.config.avatar} name={bot.config.name} />
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

/** Bara's global bar: identity, Assistant and Desk, teammates, search, attention and account. */
export function BaraTopBar({
  isAssistant,
  inboxWaiting,
  needsYou,
  children,
}: {
  isAssistant: boolean;
  inboxWaiting: boolean;
  needsYou: boolean;
  children: ReactNode;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const onDesk = pathname === "/work";
  return (
    <>
      <Link to="/" className={styles["bara-topbar-brand"]} aria-label="Bara home">
        bara<span>.</span>
      </Link>
      <nav className={styles["bara-topbar-nav"]} aria-label="Bara">
        <Link to="/" aria-current={isAssistant ? "page" : undefined}>
          <Sparkles size={15} />
          Assistant
        </Link>
        <Link to="/work" aria-current={onDesk ? "page" : undefined}>
          <Layers size={15} />
          Desk
        </Link>
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
