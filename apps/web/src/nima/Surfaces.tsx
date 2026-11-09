import { Radio, PenTool, Globe, Folder, NotebookPen } from "lucide-react";
import type { Ref } from "react";
import type { WorkSurface } from "./store";
import { WorkspaceNotesPanel } from "./WorkspaceNotesPanel";
import styles from "./nima.module.css";

export const SURFACES = [
  { name: "Browser", icon: Globe },
  { name: "Files", icon: Folder },
  { name: "Notes", icon: NotebookPen },
  { name: "Studio", icon: PenTool },
  { name: "Live Stream", icon: Radio },
] as const;

export function WorkSurfaceContent({
  surface,
  canOpenNative,
  onOpenNative,
  studioHostRef,
}: {
  surface: WorkSurface;
  canOpenNative: boolean;
  onOpenNative: (kind: "files" | "preview") => void;
  studioHostRef: Ref<HTMLDivElement>;
}) {
  return (
    <>
      <div
        className={`${styles["bara-notes-container"]} ${surface !== "Notes" ? styles["bara-hidden"] : ""}`}
      >
        <WorkspaceNotesPanel />
      </div>
      <div
        ref={studioHostRef}
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${surface === "Studio" || surface === "Live Stream" ? "" : styles["bara-hidden"]}`}
      />
      {(surface === "Browser" || surface === "Files") && (
        <div className={styles["bara-surface-empty"]}>
          <p>
            {canOpenNative
              ? `Open this conversation’s ${surface === "Files" ? "files" : "browser"}.`
              : `Send a message to save this conversation before opening ${surface.toLowerCase()}.`}
          </p>
          {(surface === "Browser" || surface === "Files") && canOpenNative && (
            <button
              className={styles["nima-action"]}
              onClick={() => onOpenNative(surface === "Files" ? "files" : "preview")}
            >
              Open {surface.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </>
  );
}
