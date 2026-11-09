import { useState } from "react";
import { useStableCallback } from "../../hooks/useStableCallback";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { useStudioLeaveGuard } from "./navigation";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { colorHex, jsonRecord, type Node } from "./model";
import styles from "./Studio.module.css";

export function StudioInlineText({
  node,
  controlsHost,
  readonly,
  missing = false,
  onSave,
  onDone,
}: {
  node: Node;
  controlsHost: HTMLElement | null;
  readonly: boolean;
  missing?: boolean;
  onSave: (text: string, original: string, overwrite: boolean) => Promise<boolean>;
  onDone: () => void;
}) {
  const [original, setOriginal] = useState(node.kind.content ?? "");
  const [draft, setDraft] = useState(original);
  const [saving, setSaving] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const changed = (node.kind.content ?? "") !== original;
  useStudioLeaveGuard(draft !== original, "Leave this text and discard your unsaved changes?");
  const focus = useStableCallback((element: HTMLTextAreaElement | null) => {
    if (element) {
      element.focus();
      element.select();
    }
  });
  const save = async (overwrite = false) => {
    if (saving || readonly) return;
    if (draft === original && !changed) {
      onDone();
      return;
    }
    setSaving(true);
    if (await onSave(draft, original, overwrite)) onDone();
    setSaving(false);
  };
  const style = jsonRecord(node.text_style);
  const size = node.kind.size ?? 32;
  const darkText = node.fill[0] * 0.299 + node.fill[1] * 0.587 + node.fill[2] * 0.114 < 128;
  return (
    <>
      <foreignObject
        x={node.bounds.x}
        y={node.bounds.y}
        width={Math.max(node.bounds.w, size * 4)}
        height={Math.max(node.bounds.h, size * 1.8)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <textarea
          ref={focus}
          aria-label="Edit text on canvas"
          className={styles.inlineText}
          value={draft}
          wrap={style.wrap ? "soft" : "off"}
          readOnly={readonly || saving}
          style={{
            fontSize: size,
            fontFamily:
              node.kind.font === "serif"
                ? "Georgia, serif"
                : node.kind.font === "mono"
                  ? "monospace"
                  : "sans-serif",
            fontWeight: style.bold ? 700 : 400,
            fontStyle: style.italic ? "italic" : "normal",
            lineHeight: Number(style.line_height ?? 1.2),
            textAlign: style.align === "center" || style.align === "right" ? style.align : "left",
            letterSpacing: Number(style.letter_spacing ?? 0),
            textDecoration: style.underline ? "underline" : "none",
            color: colorHex(node.fill),
            background: darkText ? "#fffdf8" : "#20201e",
          }}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              onDone();
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void save();
            }
          }}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Element &&
              controlsHost?.contains(event.relatedTarget)
            )
              return;
            if (event.relatedTarget instanceof SVGElement) void save();
          }}
        />
      </foreignObject>
      {controlsHost &&
        createPortal(
          <div
            className={styles.selectionBar}
            role="toolbar"
            aria-label="Text editing"
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className={styles.selectionName}>Text</span>
            {missing && (
              <>
                <span className={styles.cropHint}>Layer removed. Draft kept.</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={async () => {
                    try {
                      await writeTextToClipboard(draft);
                      setCopyStatus("Copied");
                    } catch {
                      setCopyStatus("Select the text to copy it.");
                    }
                  }}
                >
                  Copy text
                </Button>
                <span role="status">{copyStatus}</span>
              </>
            )}
            {changed && (
              <>
                <span className={styles.cropHint}>Changed elsewhere</span>
                <Button
                  size="xs"
                  variant="ghost"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const latest = node.kind.content ?? "";
                    setOriginal(latest);
                    setDraft(latest);
                  }}
                >
                  Load latest
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={saving || readonly}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => void save(true)}
                >
                  Keep my text
                </Button>
              </>
            )}
            <Button
              size="xs"
              aria-label="Save text"
              disabled={saving || readonly || changed}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Done"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onDone}
            >
              Cancel
            </Button>
          </div>,
          controlsHost,
        )}
    </>
  );
}
