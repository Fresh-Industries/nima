import { useState, type PointerEvent } from "react";
import { Button } from "../../components/ui/button";
import { StudioChoice, StudioNumber } from "./Controls";
import type { Anchor, Json, Node, Point } from "./model";

const pathContours = (node: Node) =>
  node.kind.type === "path"
    ? [
        { points: node.kind.points ?? [], closed: node.kind.closed ?? false },
        ...(node.extra_contours ?? []),
      ]
    : [];

export function StudioCurveEditor({
  node,
  disabled,
  onEdit,
}: {
  node: Node;
  disabled: boolean;
  onEdit: (commands: unknown[]) => Promise<Json | null>;
}) {
  const [contourIndex, setContourIndex] = useState(0),
    [anchorIndex, setAnchorIndex] = useState(0),
    [part, setPart] = useState<"point" | "incoming" | "outgoing">("point");
  const contours = pathContours(node),
    contour = Math.min(contourIndex, Math.max(0, contours.length - 1)),
    points = contours[contour]?.points ?? [];
  const anchor = Math.min(anchorIndex, Math.max(0, points.length - 1)),
    current = points[anchor],
    point = current?.[part];
  if (!current || !point) return null;
  const edit = (value: object) =>
    void onEdit([{ op: "edit_curve", id: node.id, edit: { contour, ...value } }]);
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Curve editor">
      <h3 className="text-xs font-medium">Curve points</h3>
      <p className="text-xs text-muted-foreground">
        Drag points and handles on the canvas. Alt-drag a point to pull its outgoing handle.
        Coordinates below are normalized.
      </p>
      <StudioChoice
        label="Contour"
        value={String(contour)}
        options={contours.map((_, index) => ({
          value: String(index),
          label: `Contour ${index + 1}`,
        }))}
        disabled={disabled}
        onChange={(value) => {
          setContourIndex(Number(value));
          setAnchorIndex(0);
        }}
      />
      <StudioChoice
        label="Anchor"
        value={String(anchor)}
        options={points.map((_, index) => ({ value: String(index), label: `Point ${index + 1}` }))}
        disabled={disabled}
        onChange={(value) => setAnchorIndex(Number(value))}
      />
      <StudioChoice
        label="Edit part"
        value={part}
        options={["point", "incoming", "outgoing"]}
        disabled={disabled}
        onChange={(value) => {
          if (value === "point" || value === "incoming" || value === "outgoing") setPart(value);
        }}
      />
      <StudioNumber
        label="Point X"
        value={point.x}
        step={0.01}
        disabled={disabled}
        onCommit={(x) =>
          edit({ type: "move", anchor, part, point: { x, y: point.y }, independent: false })
        }
      />
      <StudioNumber
        label="Point Y"
        value={point.y}
        step={0.01}
        disabled={disabled}
        onCommit={(y) =>
          edit({ type: "move", anchor, part, point: { x: point.x, y }, independent: false })
        }
      />
      <StudioChoice
        label="Point mode"
        value={current.mode ?? "corner"}
        options={["corner", "smooth", "symmetric"]}
        disabled={disabled}
        onChange={(mode) => edit({ type: "set_mode", anchor, mode })}
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={contours[contour]?.closed ?? false}
          disabled={disabled}
          onChange={(event) => edit({ type: "close", closed: event.target.checked })}
        />
        Closed contour
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={
            disabled ||
            (!contours[contour]?.closed && anchor === points.length - 1) ||
            points.length >= 512
          }
          onClick={() => edit({ type: "split", segment: anchor, t: 0.5 })}
        >
          Split next segment
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled || points.length <= (contours[contour]?.closed ? 3 : 2)}
          onClick={() => edit({ type: "remove", anchor })}
        >
          Remove point
        </Button>
      </div>
    </section>
  );
}

export function StudioCurveHandles({
  node,
  viewWidth,
  disabled,
  onEdit,
}: {
  node: Node;
  viewWidth: number;
  disabled: boolean;
  onEdit: (commands: unknown[]) => Promise<Json | null>;
}) {
  const [drag, setDrag] = useState<{
    contour: number;
    anchor: number;
    part: "point" | "incoming" | "outgoing";
    point: Point;
    independent: boolean;
  } | null>(null);
  const local = (event: PointerEvent<SVGCircleElement>): Point | null => {
    const svg = event.currentTarget.ownerSVGElement,
      matrix = svg?.getScreenCTM();
    if (!svg || !matrix || !node.bounds.w || !node.bounds.h) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return {
      x: (transformed.x - node.bounds.x) / node.bounds.w,
      y: (transformed.y - node.bounds.y) / node.bounds.h,
    };
  };
  const world = (point: Point) => ({
    x: node.bounds.x + point.x * node.bounds.w,
    y: node.bounds.y + point.y * node.bounds.h,
  });
  const move = (
    contour: number,
    anchor: number,
    part: "point" | "incoming" | "outgoing",
    point: Point,
    independent: boolean,
  ) =>
    onEdit([
      {
        op: "edit_curve",
        id: node.id,
        edit: { type: "move", contour, anchor, part, point, independent },
      },
    ]);
  return (
    <g aria-label="Path anchors" onPointerDown={(event) => event.stopPropagation()}>
      {pathContours(node).flatMap((contour, ci) =>
        contour.points.map((anchor: Anchor, ai) => {
          const displayed = (part: "point" | "incoming" | "outgoing") =>
            world(
              drag?.contour === ci && drag.anchor === ai && drag.part === part
                ? drag.point
                : anchor[part],
            );
          const point = displayed("point");
          return (
            // oxlint-disable-next-line react/no-array-index-key -- Native anchors have no IDs; ordered positions define curve edits.
            <g key={`${node.id}:${ci}:${ai}`}>
              {(["incoming", "outgoing"] as const).map((part) => {
                const handle = displayed(part);
                return (
                  <line
                    key={part}
                    x1={point.x}
                    y1={point.y}
                    x2={handle.x}
                    y2={handle.y}
                    stroke="currentColor"
                    className="text-muted-foreground"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                );
              })}
              {(["incoming", "outgoing", "point"] as const).map((part) => {
                const location = displayed(part);
                return (
                  <circle
                    key={part}
                    cx={location.x}
                    cy={location.y}
                    r={viewWidth / (part === "point" ? 140 : 180)}
                    fill="var(--background)"
                    stroke="currentColor"
                    className="text-primary"
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1.5}
                    tabIndex={disabled ? -1 : 0}
                    role="button"
                    aria-label={`Contour ${ci + 1} point ${ai + 1} ${part}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (disabled) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setDrag({
                        contour: ci,
                        anchor: ai,
                        part: part === "point" && event.altKey ? "outgoing" : part,
                        point: anchor[part],
                        independent: event.altKey,
                      });
                    }}
                    onPointerMove={(event) => {
                      if (!drag || disabled) return;
                      const point = local(event);
                      if (point) setDrag({ ...drag, point });
                    }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (!drag) return;
                      const point = local(event) ?? drag.point;
                      void move(
                        drag.contour,
                        drag.anchor,
                        drag.part,
                        point,
                        drag.independent,
                      ).finally(() => setDrag(null));
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(event) => {
                      if (disabled || !event.key.startsWith("Arrow")) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const step = event.shiftKey ? 0.01 : 0.001;
                      void move(
                        ci,
                        ai,
                        part,
                        {
                          x:
                            anchor[part].x +
                            (event.key === "ArrowRight"
                              ? step
                              : event.key === "ArrowLeft"
                                ? -step
                                : 0),
                          y:
                            anchor[part].y +
                            (event.key === "ArrowDown"
                              ? step
                              : event.key === "ArrowUp"
                                ? -step
                                : 0),
                        },
                        event.altKey,
                      );
                    }}
                  />
                );
              })}
            </g>
          );
        }),
      )}
    </g>
  );
}
