import type { StudioArea } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { randomUUID } from "../../lib/utils";
import { StudioField, StudioNumber, StudioChoice } from "./Controls";
import { StudioCurveEditor } from "./StudioCurveEditor";
import styles from "./Studio.module.css";
import { colorHex, hexColor, type Node, type Bounds, type Json } from "./model";

const record = (value: Json | undefined | null): Record<string, Json> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
export function StudioInspector({
  nodes,
  allNodes,
  area,
  disabled,
  section: requestedSection,
  onSectionChange,
  onEdit,
  onTool,
  onExport,
  onCrop,
}: {
  nodes: Node[];
  allNodes: Node[];
  area: StudioArea;
  disabled: boolean;
  section: string;
  onSectionChange: (section: string) => void;
  onEdit: (commands: unknown[]) => Promise<Json | null>;
  onTool: (tool: "hide" | "restore") => void;
  onExport: (kind: "png" | "svg" | "outlined_svg") => Promise<void>;
  onCrop: (imageId: string, region: Bounds | null) => Promise<Json | null>;
}) {
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const sections =
    node?.kind.type === "image"
      ? ["Adjust", "Crop", "Layout", "More"]
      : node?.kind.type === "text"
        ? ["Text", "Style", "Layout", "More"]
        : nodes.length > 1
          ? ["Arrange", "More"]
          : ["Style", "Layout", "More"];
  const section = sections.includes(requestedSection) ? requestedSection : sections[0]!;
  const [crop, setCrop] = useState<Bounds>({ x: 0, y: 0, w: 1, h: 1 });
  const ids = nodes.map((node) => node.id);
  const edit = (command: object) => void onEdit([command]);
  const textStyle = {
    align: "left",
    line_height: 1.2,
    letter_spacing: 0,
    bold: false,
    italic: false,
    wrap: false,
    vertical: "top",
    underline: false,
    ...record(node?.text_style),
  };
  const layout = {
    direction: "vertical",
    gap: 16,
    padding: { top: 16, right: 16, bottom: 16, left: 16 },
    main_align: "start",
    cross_align: "start",
    ...record(node?.auto_layout),
  };
  const stroke = {
    color: [44, 40, 50, 255],
    width: 2,
    cap: "round",
    join: "round",
    miter_limit: 4,
    ...record(node?.stroke),
  };
  const adjustments = node?.adjustments ?? {
    brightness: 0,
    contrast: 0,
    saturation: 1,
    warmth: 0,
    tint: 0,
  };
  return (
    <div className="space-y-6">
      {nodes.length > 0 && (
        <div
          className={styles.propertyTabs}
          role="tablist"
          aria-label="Selection properties"
          onKeyDown={(event) => {
            const tabs = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            ];
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : null;
            if (next !== null) {
              event.preventDefault();
              tabs[next]?.focus();
              tabs[next]?.click();
            }
          }}
        >
          {sections.map((label) => (
            <button
              key={label}
              role="tab"
              aria-selected={section === label}
              tabIndex={section === label ? 0 : -1}
              onClick={() => onSectionChange(label)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!nodes.length && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {area === "photo"
            ? "Import an image, then select it to adjust color, crop, or refine its mask."
            : "Choose a tool to draw. Select a layer to edit its properties."}
        </p>
      )}
      {nodes.length > 1 && (
        <section className="space-y-3" hidden={section !== "Arrange"}>
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => edit({ op: "group", id: randomUUID(), name: "Group", ids })}
            >
              Group
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                edit({ op: "create_component", id: randomUUID(), name: "Component", ids })
              }
            >
              Create component
            </Button>
          </div>
          <StudioChoice
            label="Align selection"
            value="choose"
            options={["choose", "left", "center_x", "right", "top", "center_y", "bottom"]}
            disabled={disabled}
            onChange={(alignment) => {
              if (alignment !== "choose") edit({ op: "align", ids, alignment });
            }}
          />
          <StudioChoice
            label="Combine shapes"
            value="choose"
            options={["choose", "union", "subtract", "intersect", "exclude"]}
            disabled={disabled}
            onChange={(operation) => {
              if (operation !== "choose")
                edit({
                  op: "boolean_shapes",
                  id: randomUUID(),
                  ids,
                  name: "Combined shape",
                  operation,
                });
            }}
          />
        </section>
      )}
      {node && (
        <>
          {node.kind.type === "path" && (
            <details className="space-y-3" hidden={section !== "More"}>
              <summary className="cursor-pointer text-xs font-medium">Curve points</summary>
              <StudioCurveEditor key={node.id} node={node} disabled={disabled} onEdit={onEdit} />
            </details>
          )}
          <details open hidden={section !== "Layout"} className="space-y-3">
            <summary className="cursor-pointer text-xs font-medium">Position & size</summary>
            <div className="grid grid-cols-2 gap-3">
              {(["x", "y", "w", "h"] as const).map((key) => (
                <StudioNumber
                  key={key}
                  label={{ x: "X", y: "Y", w: "Width", h: "Height" }[key]}
                  value={Math.round(node.bounds[key] * 100) / 100}
                  disabled={disabled}
                  min={key === "w" || key === "h" ? 1 : -100000}
                  max={100000}
                  onCommit={(value) =>
                    edit({
                      op: "set_bounds",
                      id: node.id,
                      bounds: { ...node.bounds, [key]: value },
                    })
                  }
                />
              ))}
            </div>
          </details>
          <section
            className={styles.styleFields}
            hidden={section !== "Style" && !(node.kind.type === "image" && section === "More")}
          >
            <h3 className="sr-only">Appearance</h3>
            <StudioField label="Fill">
              <input
                type="color"
                key={colorHex(node.fill)}
                defaultValue={colorHex(node.fill)}
                disabled={disabled}
                aria-label="Fill color"
                className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onBlur={(event) => {
                  if (event.target.value !== colorHex(node.fill))
                    edit({
                      op: "set_fill",
                      id: node.id,
                      fill: hexColor(event.target.value, node.fill[3]),
                    });
                }}
              />
            </StudioField>
            <StudioNumber
              label="Opacity (%)"
              value={(node.appearance?.opacity ?? 1) * 100}
              min={0}
              max={100}
              disabled={disabled}
              onCommit={(opacity) =>
                edit({
                  op: "set_appearance",
                  id: node.id,
                  appearance: {
                    opacity: opacity / 100,
                    blend: node.appearance?.blend ?? "normal",
                  },
                })
              }
            />
            <StudioChoice
              label="Blend"
              value={node.appearance?.blend ?? "normal"}
              options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
              disabled={disabled}
              onChange={(blend) =>
                edit({
                  op: "set_appearance",
                  id: node.id,
                  appearance: { opacity: node.appearance?.opacity ?? 1, blend },
                })
              }
            />
            {["rectangle", "frame", "image"].includes(node.kind.type) && (
              <StudioNumber
                label="Corner radius"
                value={node.corner_radius ?? 0}
                min={0}
                max={50000}
                disabled={disabled}
                onCommit={(radius) => edit({ op: "set_corner_radius", id: node.id, radius })}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  edit({
                    op: "set_gradient",
                    id: node.id,
                    gradient: node.gradient
                      ? null
                      : {
                          start: { x: 0, y: 0 },
                          end: { x: 1, y: 1 },
                          stops: [
                            { offset: 0, color: node.fill },
                            { offset: 1, color: [234, 209, 180, 255] },
                          ],
                        },
                  })
                }
              >
                {node.gradient ? "Remove gradient" : "Add gradient"}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  edit({ op: "set_stroke", id: node.id, stroke: node.stroke ? null : stroke })
                }
              >
                {node.stroke ? "Remove stroke" : "Add stroke"}
              </Button>
            </div>
            {node.stroke && (
              <>
                <StudioNumber
                  label="Stroke width"
                  value={Number(stroke.width)}
                  min={0.1}
                  max={1000}
                  step={0.5}
                  disabled={disabled}
                  onCommit={(width) =>
                    edit({ op: "set_stroke", id: node.id, stroke: { ...stroke, width } })
                  }
                />
                <StudioChoice
                  label="Line cap"
                  value={String(stroke.cap)}
                  options={["butt", "round", "square"]}
                  disabled={disabled}
                  onChange={(cap) =>
                    edit({ op: "set_stroke", id: node.id, stroke: { ...stroke, cap } })
                  }
                />
              </>
            )}
          </section>
          {node.kind.type === "text" && (
            <section className="space-y-3" hidden={section !== "Text"}>
              <h3 className="sr-only">Typography</h3>
              <StudioNumber
                label="Font size"
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
              <StudioChoice
                label="Font"
                value={node.kind.font ?? "sans"}
                options={["sans", "serif", "mono"]}
                disabled={disabled}
                onChange={(font) =>
                  edit({
                    op: "set_text",
                    id: node.id,
                    content: node.kind.content ?? "",
                    size: node.kind.size ?? 32,
                    font,
                  })
                }
              />
              <StudioChoice
                label="Text alignment"
                value={String(textStyle.align)}
                options={["left", "center", "right"]}
                disabled={disabled}
                onChange={(align) =>
                  edit({ op: "set_text_style", id: node.id, style: { ...textStyle, align } })
                }
              />
              <StudioNumber
                label="Line height"
                value={Number(textStyle.line_height)}
                min={0.5}
                max={5}
                step={0.1}
                disabled={disabled}
                onCommit={(line_height) =>
                  edit({ op: "set_text_style", id: node.id, style: { ...textStyle, line_height } })
                }
              />
              <div className="flex flex-wrap gap-2">
                {(["bold", "italic", "wrap", "underline"] as const).map((key) => (
                  <Button
                    key={key}
                    size="xs"
                    variant={textStyle[key] ? "secondary" : "outline"}
                    aria-pressed={Boolean(textStyle[key])}
                    disabled={disabled}
                    onClick={() =>
                      edit({
                        op: "set_text_style",
                        id: node.id,
                        style: { ...textStyle, [key]: !textStyle[key] },
                      })
                    }
                  >
                    {key}
                  </Button>
                ))}
              </div>
            </section>
          )}
          {node.kind.type === "image" && (
            <section className="space-y-3">
              <div className="space-y-3" hidden={section !== "Adjust"}>
                <h3 className="sr-only">Photo</h3>
                {(["brightness", "contrast", "saturation", "warmth", "tint"] as const).map(
                  (key) => (
                    <StudioNumber
                      key={key}
                      label={key.charAt(0).toUpperCase() + key.slice(1)}
                      value={adjustments[key]}
                      min={key === "saturation" ? 0 : -1}
                      max={key === "saturation" ? 2 : 1}
                      step={0.05}
                      disabled={disabled}
                      onCommit={(value) =>
                        edit({
                          op: "set_image_adjustments",
                          id: node.id,
                          adjustments: { ...adjustments, [key]: value },
                        })
                      }
                    />
                  ),
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    edit({
                      op: "set_image_adjustments",
                      id: node.id,
                      adjustments: {
                        brightness: 0,
                        contrast: 0,
                        saturation: 1,
                        warmth: 0,
                        tint: 0,
                      },
                    })
                  }
                >
                  Reset color adjustments
                </Button>
                <StudioNumber
                  label="Rotation"
                  value={node.kind.rotation ?? 0}
                  min={-360}
                  max={360}
                  disabled={disabled}
                  onCommit={(rotation) =>
                    edit({
                      op: "set_image",
                      id: node.id,
                      crop: node.kind.crop ?? { x: 0, y: 0, w: 1, h: 1 },
                      rotation,
                      aspect_locked: node.kind.aspect_locked ?? true,
                    })
                  }
                />
              </div>
              <details className="space-y-3" open hidden={section !== "Crop"}>
                <summary className="cursor-pointer text-xs font-medium">Crop image</summary>
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y", "w", "h"] as const).map((key) => (
                    <StudioNumber
                      key={key}
                      label={{ x: "Left (%)", y: "Top (%)", w: "Width (%)", h: "Height (%)" }[key]}
                      value={Math.round(crop[key] * 100)}
                      min={key === "w" || key === "h" ? 1 : 0}
                      max={100}
                      disabled={disabled}
                      onCommit={(value) => setCrop({ ...crop, [key]: value / 100 })}
                    />
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void onCrop(node.id, crop)}
                  >
                    Apply crop
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => void onCrop(node.id, null)}
                  >
                    Reset crop
                  </Button>
                </div>
              </details>
            </section>
          )}
          <details className="space-y-3" hidden={section !== "More"}>
            <summary className="cursor-pointer text-xs font-medium">Refine mask</summary>
            <div className="flex flex-wrap gap-2">
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => onTool("hide")}
              >
                Hide brush
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => onTool("restore")}
              >
                Restore brush
              </Button>
              {node.mask && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => edit({ op: "set_mask", id: node.id, mask: null })}
                >
                  Clear mask
                </Button>
              )}
            </div>
            {node.mask && (
              <>
                <StudioNumber
                  label="Feather"
                  value={node.mask.feather}
                  min={0}
                  max={100}
                  disabled={disabled}
                  onCommit={(feather) =>
                    edit({ op: "set_mask", id: node.id, mask: { ...node.mask, feather } })
                  }
                />
                <StudioNumber
                  label="Edge expansion"
                  value={node.mask.expansion}
                  min={-100}
                  max={100}
                  disabled={disabled}
                  onCommit={(expansion) =>
                    edit({ op: "set_mask", id: node.id, mask: { ...node.mask, expansion } })
                  }
                />
              </>
            )}
          </details>
          {["frame", "group"].includes(node.kind.type) && (
            <section
              className="space-y-3 border-t border-border/60 pt-4"
              hidden={section !== "Layout"}
            >
              <h3 className="text-xs font-medium">Auto layout</h3>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  edit({
                    op: "set_auto_layout",
                    id: node.id,
                    layout: node.auto_layout ? null : layout,
                  })
                }
              >
                {node.auto_layout ? "Remove auto layout" : "Add auto layout"}
              </Button>
              {node.auto_layout && (
                <>
                  <StudioChoice
                    label="Direction"
                    value={String(layout.direction)}
                    options={["horizontal", "vertical"]}
                    disabled={disabled}
                    onChange={(direction) =>
                      edit({ op: "set_auto_layout", id: node.id, layout: { ...layout, direction } })
                    }
                  />
                  <StudioNumber
                    label="Gap"
                    value={Number(layout.gap)}
                    min={0}
                    max={10000}
                    disabled={disabled}
                    onCommit={(gap) =>
                      edit({ op: "set_auto_layout", id: node.id, layout: { ...layout, gap } })
                    }
                  />
                  <StudioNumber
                    label="Padding"
                    value={Number(record(layout.padding).top ?? 16)}
                    min={0}
                    max={10000}
                    disabled={disabled}
                    onCommit={(padding) =>
                      edit({
                        op: "set_auto_layout",
                        id: node.id,
                        layout: {
                          ...layout,
                          padding: { top: padding, right: padding, bottom: padding, left: padding },
                        },
                      })
                    }
                  />
                </>
              )}
              {node.kind.type === "group" && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => edit({ op: "ungroup", id: node.id })}
                >
                  Ungroup
                </Button>
              )}
            </section>
          )}
          <details className="space-y-3" hidden={section !== "More"}>
            <summary className="cursor-pointer text-xs font-medium">Reusable components</summary>
            {node.main_component ? (
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  edit({
                    op: "place_instance",
                    id: randomUUID(),
                    main: node.id,
                    parent: node.parent,
                    at: { x: node.bounds.x + node.bounds.w + 24, y: node.bounds.y },
                  })
                }
              >
                Place linked copy
              </Button>
            ) : node.instance ? (
              <div className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => edit({ op: "reset_instance", id: node.id })}
                >
                  Reset copy
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => edit({ op: "detach_instance", id: node.id })}
                >
                  Detach
                </Button>
              </div>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  edit({
                    op: "create_component",
                    id: randomUUID(),
                    ids: [node.id],
                    name: node.name,
                  })
                }
              >
                Make component
              </Button>
            )}
            {allNodes.some((node) => node.main_component) && !node.main_component && (
              <p className="text-xs text-muted-foreground">
                Select a main component in Layers to place a linked copy.
              </p>
            )}
          </details>
          <div
            className="flex flex-wrap gap-2 border-t border-border/60 pt-4"
            hidden={section !== "More"}
          >
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => edit({ op: "reorder", id: node.id, delta: 1 })}
            >
              Bring forward
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => edit({ op: "reorder", id: node.id, delta: -1 })}
            >
              Send back
            </Button>
            {["rectangle", "ellipse", "frame"].includes(node.kind.type) && (
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => edit({ op: "convert_to_path", id: node.id })}
              >
                Convert to path
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => edit({ op: "delete", id: node.id })}
            >
              Delete layer
            </Button>
          </div>
        </>
      )}
      <section className="space-y-2 border-t border-border/60 pt-4" hidden={section !== "More"}>
        <h3 className="text-xs font-medium">{node ? "Export selected layer" : "Export canvas"}</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void onExport("svg")}
          >
            SVG
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void onExport("outlined_svg")}
          >
            Outlined SVG
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void onExport("png")}
          >
            PNG
          </Button>
        </div>
      </section>
    </div>
  );
}
