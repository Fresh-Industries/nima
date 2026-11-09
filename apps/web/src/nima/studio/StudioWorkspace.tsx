import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EnvironmentId, StudioArea } from "@t3tools/contracts";
import { Studio } from "./Studio";

// Move the portal's container, not its React tree: Live tracks and editor drafts stay owned.
export function StudioWorkspace({
  environmentId,
  target,
  active,
  area,
  id,
  docked,
  onOpen,
  onDock,
}: {
  environmentId: EnvironmentId;
  target: HTMLElement | null;
  active: boolean;
  area: StudioArea;
  id?: string;
  docked: boolean;
  onOpen: (area: StudioArea, id?: string) => void;
  onDock: (area: StudioArea, id?: string) => void;
}) {
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    element.dataset.studioInstance = environmentId;
    return element;
  });
  const [view, setView] = useState({ area, id });
  if (active && (view.area !== area || view.id !== id)) setView({ area, id });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the owned portal DOM container between workspace slots without remounting media or drafts
  useLayoutEffect(() => {
    target?.appendChild(container);
    return () => container.remove();
  }, [container, target]);
  return createPortal(
    <Studio
      environmentId={environmentId}
      area={view.area}
      {...(view.id ? { id: view.id } : {})}
      onOpen={onOpen}
      embedded={docked}
      {...(!docked ? { onDock: () => onDock(view.area, view.id) } : {})}
    />,
    container,
  );
}
