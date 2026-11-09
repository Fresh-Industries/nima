import { randomUUID } from "../../lib/utils";
import type { ReactNode } from "react";
import { Bold, Italic, ChevronDown, Pencil, SlidersHorizontal, Crop } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../../components/ui/menu";
import { StudioNumber } from "./Controls";
import { colorHex, hexColor, jsonRecord, type Node, type Json } from "./model";
import styles from "./Studio.module.css";

export function StudioSelectionBar({
  nodes,
  disabled,
  cropActive,
  onEdit,
  onText,
  onProperties,
  onCrop,
  onCancelCrop,
  chatAction,
}: {
  nodes: Node[];
  disabled: boolean;
  cropActive: boolean;
  chatAction: ReactNode;
  onEdit: (commands: unknown[]) => Promise<Json | null>;
  onText: () => void;
  onProperties: (section?: string) => void;
  onCrop: () => void;
  onCancelCrop: () => void;
}) {
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const kind = node?.kind.type;
  const text = jsonRecord(node?.text_style);
  const edit = (command: object) => void onEdit([command]);
  return (
    <div className={styles.selectionBar} role="toolbar" aria-label="Selected object">
      <span className={styles.selectionName}>
        {nodes.length > 1 ? `${nodes.length} selected` : node?.name}
      </span>
      {cropActive ? (
        <>
          <span className={styles.cropHint}>Drag to keep an area</span>
          <Button size="xs" variant="ghost" onClick={onCancelCrop}>
            Cancel crop
          </Button>
        </>
      ) : (
        <>
          {node && kind !== "image" && (
            <input
              type="color"
              aria-label="Selection color"
              className={styles.selectionColor}
              key={colorHex(node.fill)}
              defaultValue={colorHex(node.fill)}
              disabled={disabled}
              onBlur={(event) => {
                if (event.target.value !== colorHex(node.fill))
                  edit({
                    op: "set_fill",
                    id: node.id,
                    fill: hexColor(event.target.value, node.fill[3]),
                  });
              }}
            />
          )}
          {node && kind === "text" && (
            <>
              <Button size="xs" variant="ghost" disabled={disabled} onClick={onText}>
                <Pencil size={14} /> Edit text
              </Button>
              <div className={styles.quickNumber}>
                <StudioNumber
                  label="Quick font size"
                  value={node.kind.size ?? 32}
                  min={1}
                  max={1000}
                  disabled={disabled}
                  onCommit={(size) =>
                    edit({
                      op: "set_text",
                      id: node.id,
                      content: node.kind.content ?? "",
                      size,
                      font: node.kind.font ?? "sans",
                    })
                  }
                />
              </div>
              <Button
                size="icon-xs"
                variant={text.bold ? "secondary" : "ghost"}
                aria-label="Bold text"
                aria-pressed={Boolean(text.bold)}
                disabled={disabled}
                onClick={() =>
                  edit({ op: "set_text_style", id: node.id, style: { ...text, bold: !text.bold } })
                }
              >
                <Bold size={14} />
              </Button>
              <Button
                size="icon-xs"
                variant={text.italic ? "secondary" : "ghost"}
                aria-label="Italic text"
                aria-pressed={Boolean(text.italic)}
                disabled={disabled}
                onClick={() =>
                  edit({
                    op: "set_text_style",
                    id: node.id,
                    style: { ...text, italic: !text.italic },
                  })
                }
              >
                <Italic size={14} />
              </Button>
            </>
          )}
          {kind === "image" && (
            <>
              <Button size="xs" variant="ghost" onClick={() => onProperties("Adjust")}>
                <SlidersHorizontal size={14} /> Adjust
              </Button>
              <Button size="xs" variant="ghost" disabled={disabled} onClick={onCrop}>
                <Crop size={14} /> Crop
              </Button>
            </>
          )}
          <Menu>
            <MenuTrigger
              render={<Button size="xs" variant="ghost" aria-label="Arrange selection" />}
            >
              Arrange <ChevronDown size={13} />
            </MenuTrigger>
            <MenuPopup>
              {nodes.length > 1 && (
                <>
                  <MenuItem
                    disabled={disabled}
                    onClick={() =>
                      edit({
                        op: "group",
                        id: randomUUID(),
                        name: "Group",
                        ids: nodes.map((node) => node.id),
                      })
                    }
                  >
                    Group
                  </MenuItem>
                  <MenuItem disabled={disabled} onClick={() => onProperties("Arrange")}>
                    Align selection
                  </MenuItem>
                </>
              )}
              {kind === "group" && node && (
                <MenuItem disabled={disabled} onClick={() => edit({ op: "ungroup", id: node.id })}>
                  Ungroup
                </MenuItem>
              )}
              {node && (
                <>
                  <MenuItem
                    disabled={disabled}
                    onClick={() => edit({ op: "reorder", id: node.id, delta: 1 })}
                  >
                    Bring forward
                  </MenuItem>
                  <MenuItem
                    disabled={disabled}
                    onClick={() => edit({ op: "reorder", id: node.id, delta: -1 })}
                  >
                    Send back
                  </MenuItem>
                </>
              )}
              <MenuItem
                disabled={disabled}
                onClick={() => void onEdit(nodes.map((node) => ({ op: "delete", id: node.id })))}
              >
                Delete selection
              </MenuItem>
            </MenuPopup>
          </Menu>
          {chatAction}
          <Button
            size="xs"
            variant="ghost"
            aria-label="Toggle properties"
            onClick={() => onProperties()}
          >
            <SlidersHorizontal size={14} />
            <span>Properties</span>
          </Button>
        </>
      )}
    </div>
  );
}
