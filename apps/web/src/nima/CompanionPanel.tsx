import { createContext, use, type KeyboardEvent } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { SURFACES } from "./Surfaces";
import type { WorkSurface } from "./store";
import styles from "./nima.module.css";
import { isElectron } from "../env";

export const CompanionPanelContext = createContext<{
  host: HTMLElement | null;
  nativeVisible: boolean;
} | null>(null);
export function useCompanionPanel() {
  return use(CompanionPanelContext);
}

export function CompanionPanelHeader({
  title,
  selected,
  expanded,
  onSelect,
  onExpand,
  onClose,
}: {
  title: string;
  selected: WorkSurface | null;
  expanded: boolean;
  onSelect: (surface: WorkSurface) => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : event.key === "ArrowLeft"
              ? (index + tabs.length - 1) % tabs.length
              : null;
    if (next === null) return;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <>
      <div className={`${styles["bara-companion-heading"]} ${isElectron ? "drag-region" : ""}`}>
        <span>{title}</span>
        <div>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-label={expanded ? "Return to conversation" : "Expand current surface"}
                  onClick={onExpand}
                >
                  {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              }
            />
            <TooltipPopup>{expanded ? "Return to conversation" : "Expand surface"}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button aria-label="Close contextual panel" onClick={onClose}>
                  <X size={16} />
                </button>
              }
            />
            <TooltipPopup>Close panel</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      <div
        className={styles["bara-companion-tabs"]}
        role="tablist"
        aria-label="Companion tools"
        onKeyDown={moveTab}
      >
        {SURFACES.map(({ name, icon: Icon }, index) => (
          <Tooltip key={name}>
            <TooltipTrigger
              render={
                <button
                  role="tab"
                  id={`bara-tool-${name.replaceAll(" ", "-").toLowerCase()}`}
                  aria-label={name}
                  aria-controls="bara-companion-content"
                  aria-selected={selected === name}
                  tabIndex={selected === name || (selected === null && index === 0) ? 0 : -1}
                  onClick={() => onSelect(name)}
                >
                  <Icon size={17} strokeWidth={1.6} />
                </button>
              }
            />
            <TooltipPopup side="bottom">{name}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </>
  );
}
