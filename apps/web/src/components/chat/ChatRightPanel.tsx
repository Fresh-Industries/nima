import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import { RightPanelSheet } from "../RightPanelSheet";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";

type ChatRightPanelProps = Omit<RightPanelTabsProps, "mode" | "inlineSize" | "maximized"> & {
  readonly embedded?: boolean;
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly workspaceLayoutElement: HTMLElement | null;
  readonly widthStorageKey: string;
  readonly sheetAnimationDurationMs: number;
  readonly onCloseSheet: () => void;
};

/**
 * The right panel, inline beside the chat column or as a sheet on narrow
 * layouts. Its width follows a resize drag every frame, so the width state
 * lives here rather than in ChatView.
 */
export function ChatRightPanel(props: ChatRightPanelProps) {
  const {
    sheet,
    embedded = false,
    workspaceLayoutElement,
    widthStorageKey,
    sheetAnimationDurationMs,
    onCloseSheet,
    maximized,
    layoutControls,
    ...tabs
  } = props;
  const inlineSize = usePreviewPanelInlineSize({
    enabled: !embedded,
    container: workspaceLayoutElement,
    widthStorageKey,
  });
  if (embedded) {
    const active = tabs.surfaces.find((surface) => surface.id === tabs.activeSurfaceId);
    const surfaces = tabs.surfaces.filter((surface) =>
      active?.kind === "preview"
        ? surface.kind === "preview"
        : active?.kind === "files" || active?.kind === "file"
          ? surface.kind === "files" || surface.kind === "file"
          : true,
    );
    return (
      <RightPanelTabs
        {...tabs}
        mode="embedded"
        layoutControls={null}
        surfaces={surfaces}
        onCloseOtherSurfaces={(surface) => {
          for (const entry of surfaces) if (entry.id !== surface.id) tabs.onCloseSurface(entry);
        }}
        onCloseSurfacesToRight={(surface) => {
          const index = surfaces.findIndex((entry) => entry.id === surface.id);
          if (index < 0) return;
          for (const entry of surfaces.slice(index + 1)) tabs.onCloseSurface(entry);
        }}
        onCloseAllSurfaces={() => {
          for (const surface of surfaces) tabs.onCloseSurface(surface);
        }}
        {...(tabs.onMoveSurface
          ? {
              onMoveSurface: (id, index) => {
                const target = surfaces[index];
                if (target) tabs.onMoveSurface?.(id, tabs.surfaces.indexOf(target));
              },
            }
          : {})}
      />
    );
  }
  if (!sheet) {
    return <RightPanelTabs {...tabs} mode="inline" maximized={maximized} inlineSize={inlineSize} />;
  }
  return (
    <RightPanelSheet
      animationDurationMs={sheetAnimationDurationMs}
      open={tabs.open === true}
      onClose={onCloseSheet}
    >
      <RightPanelTabs
        {...tabs}
        mode="sheet"
        inlineSize={inlineSize}
        layoutControls={layoutControls}
      />
    </RightPanelSheet>
  );
}
