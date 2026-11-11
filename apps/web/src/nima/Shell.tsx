import { WorkSessionContext } from "./workSessionContext";
import { WorkSessionHeader } from "./WorkSessionDetails";
import { usePageAutosave } from "./pageWrites";
import { CompanionPanelContext, CompanionPanelHeader } from "./CompanionPanel";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { type EnvironmentId, type StudioArea } from "@t3tools/contracts";
import { usePrimaryEnvironmentId } from "../state/environments";
import { StudioWorkspace } from "./studio/StudioWorkspace";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { PanelRight } from "lucide-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useRightPanelStore } from "../rightPanelStore";
import { BotConversationContext, useBots } from "./useBots";
import { useNimaStore } from "./store";
import { PersonalChatContext, useIsDailyConversation } from "./useDailyConversation";
import { useImportWorkspaceReview, useWorkspaceReview } from "./useWorkspaceReview";
import { threadNeedsYou } from "./workState";
import { WorkSurfaceContent } from "./Surfaces";
import { BaraTopBar } from "./BaraTopBar";
import { FloatingAssistant } from "./FloatingAssistant";
import { BaraDock } from "./BaraDock";
import styles from "./nima.module.css";
import { isElectron } from "../env";
import { observeResize } from "../lib/observeResize";
import { useVisibleThreadShells } from "../state/entities";

export function BaraFrame({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the resize handle reports and clamps to the actual workspace after window/sidebar resizing
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const stop = observeResize(frame, () => setFrameWidth(frame.clientWidth));
    setFrameWidth(frame.clientWidth);
    return stop;
  }, []);
  usePageAutosave();
  const open = useNimaStore((state) => state.utilityOpen);
  const preference = useNimaStore((state) => state.companionPreference);
  const utilityWidth = useNimaStore((state) => state.utilityWidth);
  const studioWidth = useNimaStore((state) => state.studioWidth);
  const studioView = useNimaStore((state) => state.studioView);
  const surface = useNimaStore((state) => state.surface);
  const expanded = useNimaStore((state) => state.surfaceExpanded);
  const studioSurface = surface === "Studio" || surface === "Live Stream";
  const width = studioSurface ? studioWidth : utilityWidth;
  const navigate = useNavigate();
  const isAssistant = useIsDailyConversation();
  const target = useThreadRouteTarget();
  const ref = target?.kind === "server" ? target.threadRef : null;
  const workReview = useWorkspaceReview();
  useImportWorkspaceReview(workReview);
  const workMetadata = ref ? workReview.metadata.get(scopedThreadKey(ref)) : undefined;
  const workSessionConversation = workMetadata?.kind === "focus";
  const needsYou = useVisibleThreadShells().some(threadNeedsYou);
  const inboxWaiting = needsYou || workReview.pendingCount > 0;
  const nativeState = useRightPanelStore((state) =>
    ref ? state.byThreadKey[scopedThreadKey(ref)] : undefined,
  );
  const nativeOpen = Boolean(nativeState?.isOpen);
  const activeNative = nativeState?.surfaces.find(
    (entry) => entry.id === nativeState.activeSurfaceId,
  );
  const nativeTool =
    activeNative?.kind === "preview"
      ? "Browser"
      : activeNative?.kind === "files" || activeNative?.kind === "file"
        ? "Files"
        : null;
  const selected = nativeOpen ? nativeTool : surface;
  const shownPreference = nativeOpen || (preference ?? Boolean(target && !isAssistant && open));
  const pathname = useLocation({ select: (location) => location.pathname });
  const studioSearch = useLocation({ select: (location) => location.search });
  const primaryHost = usePrimaryEnvironmentId();
  const botState = useBots(ref?.environmentId);
  const activeBot = ref ? botState.bots.find((bot) => bot.threadId === ref.threadId) : undefined;
  const studioPage = pathname === "/studio";
  const shown = shownPreference && !(studioPage && studioSurface && !nativeOpen);
  const maximized =
    expanded ||
    (!resizing &&
      shown &&
      frameWidth > 0 &&
      window.matchMedia("(min-width: 1101px)").matches &&
      width > Math.max(280, frameWidth - 360));
  const studioEnvironment = studioPage
    ? ((studioSearch.environmentId as EnvironmentId | undefined) ?? primaryHost)
    : (studioView?.environmentId ?? ref?.environmentId ?? primaryHost);
  const studioArea = studioPage
    ? ((studioSearch.area as StudioArea | undefined) ?? "design")
    : (studioView?.area ?? "design");
  const studioId = studioPage ? (studioSearch.id as string | undefined) : studioView?.id;
  const [studioHosts, setStudioHosts] = useState<EnvironmentId[]>([]);
  if (
    (studioPage || (studioSurface && shown)) &&
    studioEnvironment &&
    !studioHosts.includes(studioEnvironment)
  )
    setStudioHosts([...studioHosts, studioEnvironment]);
  const [mainStudioHost, setMainStudioHost] = useState<HTMLDivElement | null>(null);
  const [dockStudioHost, setDockStudioHost] = useState<HTMLDivElement | null>(null);
  const [parkedStudioHost, setParkedStudioHost] = useState<HTMLDivElement | null>(null);
  const modal = pathname.startsWith("/settings") || pathname === "/usage";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeNative = () => {
    if (ref) useRightPanelStore.getState().close(ref);
  };
  const native = (kind: "files" | "preview") => {
    if (!ref) return;
    const previous = useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)];
    const active = previous?.surfaces.find((entry) => entry.id === previous.activeSurfaceId);
    if (active && (active.kind === kind || (kind === "files" && active.kind === "file")))
      useRightPanelStore.getState().activateSurface(ref, active.id);
    else useRightPanelStore.getState().open(ref, kind);
  };
  const close = () => {
    toggleRef.current?.focus();
    closeNative();
    useNimaStore.getState().setUtilityOpen(false);
    useNimaStore.getState().expandSurface(false);
  };
  const choose = (next: typeof surface) => {
    useNimaStore.getState().selectSurface(next);
    if ((next === "Studio" || next === "Live Stream") && studioEnvironment) {
      useNimaStore.getState().openStudio({
        environmentId: studioEnvironment,
        area: next === "Live Stream" ? "live" : (studioView?.area ?? "design"),
        ...(next === "Studio" && studioView?.id ? { id: studioView.id } : {}),
      });
      if (studioPage) void navigate({ to: "/" });
    }
    if (ref && (next === "Files" || next === "Browser"))
      native(next === "Files" ? "files" : "preview");
    else closeNative();
  };
  const title = nativeOpen ? (nativeTool ?? "Work tools") : surface;
  return (
    <CompanionPanelContext value={{ host, nativeVisible: nativeOpen && shown && !modal }}>
      <div
        ref={frameRef}
        className={styles["nima-frame"]}
        data-bara-workspace
        data-nima-daily={isAssistant || undefined}
        data-bara-chat={
          (ref && (isAssistant || Boolean(activeBot) || workSessionConversation)) || undefined
        }
      >
        <div className={styles["nima-center"]}>
          <div className={`${styles["nima-topbar"]} ${isElectron ? "drag-region" : ""}`}>
            <BaraTopBar inboxWaiting={inboxWaiting} needsYou={needsYou}>
              <button
                ref={toggleRef}
                aria-label="Toggle contextual panel"
                aria-expanded={shown && !modal}
                onClick={() => (shown ? close() : choose(surface))}
              >
                <PanelRight size={17} />
              </button>
            </BaraTopBar>
          </div>
          {activeBot && !activeBot.home && ref && (
            <div className="flex items-center gap-5 border-b border-border/50 px-5 py-2 text-xs text-muted-foreground">
              <Link to="/bots">← Bots</Link>
              <span className="min-w-0 flex-1 truncate">{activeBot.config.description}</span>
              <Link
                to="/bots"
                search={{ botId: activeBot.id, environmentId: ref.environmentId, settings: true }}
              >
                Bot settings
              </Link>
              <Link to="/work" search={{ environmentId: ref.environmentId, botId: activeBot.id }}>
                Work
              </Link>
              <Link
                to="/bots"
                search={{ environmentId: ref.environmentId, botId: activeBot.id, view: "routines" }}
              >
                Routines
              </Link>
            </div>
          )}
          {ref && !activeBot && !isAssistant && (
            <WorkSessionHeader key={scopedThreadKey(ref)} threadRef={ref} />
          )}
          <div className={styles["nima-content"]} inert={maximized && shown && !modal}>
            <div className={studioPage ? "hidden" : "contents"}>
              <BotConversationContext value={activeBot ?? null}>
                <WorkSessionContext value={workSessionConversation}>
                  <PersonalChatContext value={isAssistant}>{children}</PersonalChatContext>
                </WorkSessionContext>
              </BotConversationContext>
            </div>
            {studioPage && !studioEnvironment && (
              <p className="m-auto p-8 text-sm text-muted-foreground">
                Connect to your Bara server to open Studio.
              </p>
            )}
            <div
              ref={setMainStudioHost}
              className={studioPage ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}
            />
          </div>
        </div>
        {!modal && <BaraDock />}
        <FloatingAssistant hidden={isAssistant || modal} />
        <aside
          className={`${styles["bara-companion"]} ${!shown || modal ? styles["bara-hidden"] : ""} ${maximized ? styles["bara-companion-expanded"] : ""}`}
          style={{ width }}
          data-studio-surface={studioSurface || undefined}
          aria-label="Companion panel"
          inert={!shown || modal}
        >
          {!maximized && (
            <div
              className={styles["nima-resize"]}
              role="separator"
              aria-label="Resize contextual panel"
              aria-orientation="vertical"
              aria-valuemin={Math.min(280, frameWidth || 280)}
              aria-valuemax={frameWidth || width}
              aria-valuenow={Math.min(width, frameWidth || width)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const resize = studioSurface
                    ? useNimaStore.getState().setStudioWidth
                    : useNimaStore.getState().setUtilityWidth;
                  resize(
                    Math.min(
                      frameWidth,
                      Math.min(width, frameWidth) + (event.key === "ArrowLeft" ? 20 : -20),
                    ),
                  );
                }
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                setResizing(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  const resize = studioSurface
                    ? useNimaStore.getState().setStudioWidth
                    : useNimaStore.getState().setUtilityWidth;
                  const bounds = frameRef.current?.getBoundingClientRect();
                  if (bounds) resize(Math.min(bounds.width, bounds.right - event.clientX));
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                setResizing(false);
              }}
              onPointerCancel={() => setResizing(false)}
              onLostPointerCapture={() => setResizing(false)}
            />
          )}
          <CompanionPanelHeader
            title={title}
            selected={selected}
            expanded={maximized}
            onSelect={choose}
            onClose={close}
            onExpand={() => {
              if (maximized && window.matchMedia("(max-width: 1100px)").matches) close();
              else {
                if (maximized) {
                  const resize = studioSurface
                    ? useNimaStore.getState().setStudioWidth
                    : useNimaStore.getState().setUtilityWidth;
                  resize(Math.min(width, Math.max(280, frameWidth - 360)));
                }
                useNimaStore.getState().expandSurface(!maximized);
              }
            }}
          />
          <div
            ref={setHost}
            id={nativeOpen ? "bara-companion-content" : undefined}
            className={`${styles["bara-native-host"]} ${!nativeOpen ? styles["bara-hidden"] : ""}`}
            role={nativeOpen ? "tabpanel" : undefined}
            aria-label={nativeOpen ? title : undefined}
            aria-labelledby={
              nativeOpen && nativeTool ? `bara-tool-${nativeTool.toLowerCase()}` : undefined
            }
          />
          <div
            id={nativeOpen ? undefined : "bara-companion-content"}
            className={`${styles["bara-surface-body"]} ${nativeOpen ? styles["bara-hidden"] : ""}`}
            role={nativeOpen ? undefined : "tabpanel"}
            aria-label={nativeOpen ? undefined : surface}
            aria-labelledby={
              nativeOpen ? undefined : `bara-tool-${surface.replaceAll(" ", "-").toLowerCase()}`
            }
          >
            <WorkSurfaceContent
              surface={surface}
              studioHostRef={setDockStudioHost}
              canOpenNative={ref !== null}
              onOpenNative={native}
            />
          </div>
        </aside>
        <div ref={setParkedStudioHost} className="hidden" inert aria-hidden="true" />
        {studioHosts.map((environmentId) => {
          const active = environmentId === studioEnvironment;
          const docked = !studioPage && active && studioSurface && shown && !nativeOpen && !modal;
          return (
            <StudioWorkspace
              key={environmentId}
              environmentId={environmentId}
              target={
                active && studioPage && !modal
                  ? mainStudioHost
                  : docked
                    ? dockStudioHost
                    : parkedStudioHost
              }
              active={active}
              area={studioArea}
              {...(studioId ? { id: studioId } : {})}
              docked={docked}
              onOpen={(area, id) => {
                if (studioPage)
                  void navigate({
                    to: "/studio",
                    search: { environmentId, area, ...(id ? { id } : {}) },
                  });
                else
                  useNimaStore
                    .getState()
                    .openStudio({ environmentId, area, ...(id ? { id } : {}) });
              }}
              onDock={(area, id) => {
                closeNative();
                useNimaStore.getState().expandSurface(false);
                useNimaStore.getState().openStudio({ environmentId, area, ...(id ? { id } : {}) });
                void navigate({ to: "/" });
              }}
            />
          );
        })}
      </div>
    </CompanionPanelContext>
  );
}
