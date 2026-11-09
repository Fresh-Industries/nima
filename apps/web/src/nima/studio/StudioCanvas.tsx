import type { EnvironmentId, StudioArea } from "@t3tools/contracts";
import { StudioCurveHandles } from "./StudioCurveEditor";
import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  Circle,
  Eye,
  EyeOff,
  Frame,
  Hand,
  ImagePlus,
  Layers,
  Lock,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Input } from "../../components/ui/input";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../../components/ui/menu";
import { StudioSelectionBar } from "./StudioSelectionBar";
import { StudioInlineText } from "./StudioInlineText";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../components/ui/tooltip";
import { randomUUID } from "../../lib/utils";
import { useStudio, downloadStudioFiles, type StudioSession } from "./useStudio";
import { nodeFor, type Artwork, type Asset, type Bounds, type Point, type Node } from "./model";
import { StudioInspector } from "./StudioInspector";
import { studioImage } from "./imageImport";
import styles from "./Studio.module.css";
import { WorkOnStudio } from "./WorkOnStudio";
import { StudioChatStatus } from "./StudioChatStatus";
import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";

type Tool =
  | "select"
  | "pan"
  | "frame"
  | "rectangle"
  | "ellipse"
  | "text"
  | "pencil"
  | "hide"
  | "restore"
  | "crop";
type Gesture = {
  tool: Tool;
  revision: number;
  start: Point;
  point: Point;
  points: Point[];
  bounds: Record<string, Bounds>;
  view: Bounds;
  screenStart: Point;
  scale: number;
  corner?: "nw" | "ne" | "sw" | "se";
  keepAspect?: boolean;
};
function resized(bounds: Bounds, gesture: Gesture, point: Point): Bounds {
  const west = gesture.corner?.includes("w"),
    north = gesture.corner?.includes("n");
  const dx = (point.x - gesture.start.x) * (west ? -1 : 1),
    dy = (point.y - gesture.start.y) * (north ? -1 : 1);
  let w = Math.max(1, bounds.w + dx),
    h = Math.max(1, bounds.h + dy);
  if (gesture.keepAspect) {
    if (Math.abs(dx / bounds.w) >= Math.abs(dy / bounds.h)) h = (w * bounds.h) / bounds.w;
    else w = (h * bounds.w) / bounds.h;
  }
  return {
    x: west ? bounds.x + bounds.w - w : bounds.x,
    y: north ? bounds.y + bounds.h - h : bounds.y,
    w,
    h,
  };
}
const tools = [
  { id: "select", icon: MousePointer2, name: "Select (V)" },
  { id: "pan", icon: Hand, name: "Pan (H)" },
  { id: "frame", icon: Frame, name: "Frame (F)" },
  { id: "rectangle", icon: Square, name: "Rectangle (R)" },
  { id: "ellipse", icon: Circle, name: "Ellipse (O)" },
  { id: "text", icon: Type, name: "Text (T)" },
  { id: "pencil", icon: Pencil, name: "Draw (P)" },
] as const;
function viewFromSvg(svg: string): Bounds {
  const values = svg
    .match(/viewBox="([^"]+)"/)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  return values?.length === 4
    ? { x: values[0]!, y: values[1]!, w: Math.max(values[2]!, 1), h: Math.max(values[3]!, 1) }
    : { x: 0, y: 0, w: 1080, h: 1350 };
}
function eventPoint(event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>): Point {
  const matrix = event.currentTarget.getScreenCTM();
  const point = new DOMPoint(event.clientX, event.clientY);
  return matrix ? point.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
}
export function StudioCanvas({
  environmentId,
  asset,
  area,
}: {
  environmentId: EnvironmentId;
  asset: Asset;
  area: StudioArea;
  catalog: StudioSession;
}) {
  const session = useStudio({ scope: "artwork", id: asset.id }, environmentId);
  const artwork = session.query.data?.data as Artwork | null | undefined;
  const issue = session.error || session.query.error || session.query.data?.message;
  if (!artwork)
    return (
      <section
        className="m-auto space-y-3 p-6 text-center text-sm text-muted-foreground"
        aria-label="Canvas loading"
      >
        <p role={issue ? "alert" : "status"}>
          {issue || (session.connected ? "Opening canvas…" : "Reconnect to open this canvas.")}
        </p>
        {issue && (
          <Button size="sm" variant="outline" onClick={session.query.refresh}>
            Retry
          </Button>
        )}
      </section>
    );
  const svg = session.query.data?.svg ?? "";
  return (
    <CanvasEditor
      key={asset.id}
      asset={asset}
      area={area}
      artwork={artwork}
      svg={svg}
      session={session}
    />
  );
}

function CanvasEditor({
  asset,
  area,
  artwork,
  svg,
  session,
}: {
  asset: Asset;
  area: StudioArea;
  artwork: Artwork;
  svg: string;
  session: StudioSession;
}) {
  const nodes = artwork.document.nodes;
  const base = viewFromSvg(svg);
  const fittedView = () => ({ x: base.x - 80, y: base.y - 80, w: base.w + 160, h: base.h + 160 });
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelectionState] = useState<string[]>([]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [view, setView] = useState<Bounds>(fittedView);
  const [spacePan, setSpacePan] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [layersOpen, setLayersOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorSection, setInspectorSection] = useState("Style");
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [textControlsHost, setTextControlsHost] = useState<HTMLDivElement | null>(null);
  const canvas = useRef<SVGSVGElement>(null);
  const restoreCanvasFocus = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- returns focus to the canvas after the user finishes or cancels the mounted text editor
  useLayoutEffect(() => {
    if (!editingText && restoreCanvasFocus.current) {
      restoreCanvasFocus.current = false;
      canvas.current?.focus();
    }
  }, [editingText]);
  const setSelection = (ids: string[]) => {
    if (ids.length === selection.length && ids.every((id, index) => id === selection[index]))
      return;
    setSelectionState(ids);
    if (!ids.length) {
      setInspectorOpen(false);
      setSheetExpanded(false);
    }
    const single = ids.length === 1 ? nodes.find((node) => node.id === ids[0]) : undefined;
    setInspectorSection(
      ids.length > 1
        ? "Arrange"
        : single?.kind.type === "image"
          ? "Adjust"
          : single?.kind.type === "text"
            ? "Text"
            : "Style",
    );
  };
  const startText = (id: string) => {
    setEditingText(id);
    setInspectorOpen(false);
    setLayersOpen(false);
  };
  const finishText = () => {
    restoreCanvasFocus.current = true;
    setEditingText(null);
  };
  const upload = useRef<HTMLInputElement>(null);
  const visibleView = view;
  const zoomPercent =
    canvasSize.w && canvasSize.h
      ? Math.round(Math.min(canvasSize.w / view.w, canvasSize.h / view.h) * 100)
      : null;
  const wheel = useStableCallback((event: WheelEvent) => {
    if (editingText || !canvas.current) return;
    const matrix = canvas.current.getScreenCTM();
    if (!matrix) return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.current.clientHeight : 1;
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.max(
        matrix.a / 16,
        Math.min(matrix.a / 0.02, Math.exp(event.deltaY * unit * 0.004)),
      );
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      setView((current) => ({
        x: point.x + (current.x - point.x) * factor,
        y: point.y + (current.y - point.y) * factor,
        w: current.w * factor,
        h: current.h * factor,
      }));
    } else {
      const dx =
        ((event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit) / matrix.a;
      const dy = ((event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit) / matrix.a;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- canvas wheel gestures need a non-passive listener to keep browser zoom and page scrolling from consuming them
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    element.addEventListener("wheel", wheel, { passive: false });
    const stop = observeResize(element, () => {
      const rect = element.getBoundingClientRect();
      setCanvasSize({ w: rect.width, h: rect.height });
    });
    return () => {
      element.removeEventListener("wheel", wheel);
      stop();
    };
  }, [wheel]);
  const selected = nodes.filter((node) => selection.includes(node.id));
  const available = session.canWrite && !session.busy;
  const canvasAvailable = available && !editingText;
  const liveEditingNode = nodes.find((node) => node.id === editingText);
  const [retainedEditingNode, setRetainedEditingNode] = useState<Node | null>(null);
  if (liveEditingNode && liveEditingNode !== retainedEditingNode)
    setRetainedEditingNode(liveEditingNode);
  const editingNode =
    liveEditingNode ?? (retainedEditingNode?.id === editingText ? retainedEditingNode : undefined);
  const edit = (commands: unknown[]) =>
    session.write("artwork", artwork.revision, { type: "edit", commands }, { id: asset.id });
  const exportFile = async (kind: "png" | "svg" | "outlined_svg", selectionOnly = false) => {
    const result = await session.download({
      kind,
      id: asset.id,
      expectedRevision: artwork.revision,
      ...(selectionOnly && selected.length === 1 ? { layerId: selected[0]!.id } : {}),
    });
    if (result) await downloadStudioFiles([...result.files]);
  };
  const editable = (node: (typeof nodes)[number]): boolean => {
    const visited = new Set<string>();
    let ancestor: typeof node | undefined = node;
    while (ancestor) {
      if (!ancestor.visible || ancestor.locked || visited.has(ancestor.id)) return false;
      visited.add(ancestor.id);
      ancestor = nodes.find((candidate) => candidate.id === ancestor!.parent);
    }
    return true;
  };
  const parentAt = (bounds: Bounds) =>
    nodes
      .slice()
      .reverse()
      .find(
        (node) =>
          node.kind.type === "frame" &&
          editable(node) &&
          bounds.x >= node.bounds.x &&
          bounds.y >= node.bounds.y &&
          bounds.x + bounds.w <= node.bounds.x + node.bounds.w &&
          bounds.y + bounds.h <= node.bounds.y + node.bounds.h,
      )?.id ?? null;
  const zoom = (requested: number) => {
    const scale = canvas.current?.getScreenCTM()?.a ?? 1;
    const factor = Math.max(scale / 16, Math.min(scale / 0.02, requested));
    setView({
      x: visibleView.x + (visibleView.w * (1 - factor)) / 2,
      y: visibleView.y + (visibleView.h * (1 - factor)) / 2,
      w: visibleView.w * factor,
      h: visibleView.h * factor,
    });
  };
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (editingText) {
      event.currentTarget.focus();
      return;
    }
    event.currentTarget.focus();
    const point = eventPoint(event);
    const activeTool = event.button === 1 || spacePan ? "pan" : tool;
    if (!available && activeTool !== "select" && activeTool !== "pan") return;
    let picked = selection;
    const only = selected.length === 1 ? selected[0] : undefined;
    const radius = 8 / (event.currentTarget.getScreenCTM()?.a ?? 1);
    const corner =
      activeTool === "select" && only && editable(only) && available
        ? (["nw", "ne", "sw", "se"] as const).find(
            (corner) =>
              Math.hypot(
                point.x - (only.bounds.x + (corner.includes("e") ? only.bounds.w : 0)),
                point.y - (only.bounds.y + (corner.includes("s") ? only.bounds.h : 0)),
              ) <= radius,
          )
        : undefined;
    if (activeTool === "select" && !corner) {
      const hit = nodes
        .slice()
        .reverse()
        .find(
          (node) =>
            editable(node) &&
            point.x >= node.bounds.x &&
            point.x <= node.bounds.x + node.bounds.w &&
            point.y >= node.bounds.y &&
            point.y <= node.bounds.y + node.bounds.h,
        );
      picked = hit
        ? event.shiftKey
          ? selection.includes(hit.id)
            ? selection.filter((id) => id !== hit.id)
            : [...selection, hit.id]
          : selection.includes(hit.id)
            ? selection
            : [hit.id]
        : [];
      setSelection(picked);
    }
    if ((activeTool === "hide" || activeTool === "restore") && selected.length !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      tool: activeTool,
      revision: artwork.revision,
      start: point,
      point,
      points: [point],
      bounds: Object.fromEntries(
        nodes.filter((node) => picked.includes(node.id)).map((node) => [node.id, node.bounds]),
      ),
      view: visibleView,
      screenStart: { x: event.clientX, y: event.clientY },
      scale: event.currentTarget.getScreenCTM()?.a ?? 1,
      ...(corner
        ? {
            corner,
            keepAspect:
              event.shiftKey || (only?.kind.type === "image" && only.kind.aspect_locked !== false),
          }
        : {}),
    });
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    if (gesture.tool === "pan") {
      const dx = (event.clientX - gesture.screenStart.x) / gesture.scale;
      const dy = (event.clientY - gesture.screenStart.y) / gesture.scale;
      setView({ ...gesture.view, x: gesture.view.x - dx, y: gesture.view.y - dy });
      return;
    }
    const point = eventPoint(event);
    const last = gesture.points.at(-1)!;
    const record =
      ["pencil", "hide", "restore"].includes(gesture.tool) &&
      gesture.points.length < 500 &&
      Math.hypot(point.x - last.x, point.y - last.y) > 2;
    setGesture({ ...gesture, point, points: record ? [...gesture.points, point] : gesture.points });
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    const point = eventPoint(event);
    const active = gesture;
    setGesture(null);
    if (!available || active.tool === "pan") return;
    if (active.tool === "crop") {
      const image = selected.length === 1 ? selected[0] : undefined;
      if (image?.kind.type !== "image" || !editable(image)) return;
      const x = Math.max(image.bounds.x, Math.min(active.start.x, point.x));
      const y = Math.max(image.bounds.y, Math.min(active.start.y, point.y));
      const right = Math.min(image.bounds.x + image.bounds.w, Math.max(active.start.x, point.x));
      const bottom = Math.min(image.bounds.y + image.bounds.h, Math.max(active.start.y, point.y));
      if (right - x > 1 && bottom - y > 1) {
        void session.write(
          "photo_crop",
          active.revision,
          {
            imageId: image.id,
            region: {
              x: (x - image.bounds.x) / image.bounds.w,
              y: (y - image.bounds.y) / image.bounds.h,
              w: (right - x) / image.bounds.w,
              h: (bottom - y) / image.bounds.h,
            },
          },
          { id: asset.id },
        );
        setTool("select");
      }
      return;
    }
    if (active.corner) {
      void edit(
        Object.entries(active.bounds).map(([id, bounds]) => ({
          op: "set_bounds",
          id,
          bounds: resized(bounds, active, point),
        })),
      );
      return;
    }
    const dx = point.x - active.start.x,
      dy = point.y - active.start.y;
    if (active.tool === "select") {
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      void edit(
        Object.entries(active.bounds).map(([id, bounds]) => ({
          op: "set_bounds",
          id,
          bounds: { ...bounds, x: bounds.x + dx, y: bounds.y + dy },
        })),
      );
      return;
    }
    if (active.tool === "hide" || active.tool === "restore") {
      const node = selected[0]!;
      const bounds = node.mask?.space ?? node.bounds;
      const angle = -((node.kind.rotation ?? 0) * Math.PI) / 180;
      const center = { x: node.bounds.x + node.bounds.w / 2, y: node.bounds.y + node.bounds.h / 2 };
      const mask = node.mask ?? {
        enabled: true,
        inverted: false,
        base_visible: true,
        feather: 0,
        expansion: 0,
        base_asset: null,
        strokes: [],
      };
      void edit([
        {
          op: "set_mask",
          id: node.id,
          mask: {
            ...mask,
            enabled: true,
            strokes: [
              ...mask.strokes,
              {
                restore: active.tool === "restore",
                opacity: 1,
                radius: 0.035,
                points: active.points.map((p) => ({
                  x:
                    (center.x +
                      (p.x - center.x) * Math.cos(angle) -
                      (p.y - center.y) * Math.sin(angle) -
                      bounds.x) /
                    bounds.w,
                  y:
                    (center.y +
                      (p.x - center.x) * Math.sin(angle) +
                      (p.y - center.y) * Math.cos(angle) -
                      bounds.y) /
                    bounds.h,
                })),
              },
            ],
          },
        },
      ]);
      return;
    }
    const bounds = {
      x: Math.min(point.x, active.start.x),
      y: Math.min(point.y, active.start.y),
      w: Math.max(Math.abs(dx), active.tool === "text" ? 240 : 20),
      h: Math.max(Math.abs(dy), active.tool === "text" ? 72 : 20),
    };
    const node = nodeFor(active.tool === "pencil" ? "path" : active.tool, bounds, randomUUID());
    node.parent = parentAt(bounds);
    if (active.tool === "pencil") {
      node.name = "Drawing";
      node.fill = [0, 0, 0, 0];
      node.kind = {
        type: "path",
        closed: false,
        stroke: [180, 160, 210, 255],
        stroke_width: 3,
        points: active.points.map((p) => {
          const relative = { x: (p.x - bounds.x) / bounds.w, y: (p.y - bounds.y) / bounds.h };
          return { point: relative, incoming: relative, outgoing: relative };
        }),
      };
      if (active.points.length < 2) return;
    }
    void edit([{ op: "add", node }]).then((saved) => {
      if (saved && active.tool === "text") startText(node.id);
    });
    setSelection([node.id]);
    setTool("select");
  };
  const importImage = async (file: File) => {
    try {
      const image = await studioImage(file);
      const scale = Math.min(1, (base.w * 0.8) / image.width, (base.h * 0.8) / image.height);
      const node = nodeFor(
        "image",
        {
          x: base.x + base.w / 2 - (image.width * scale) / 2,
          y: base.y + base.h / 2 - (image.height * scale) / 2,
          w: Math.max(1, image.width * scale),
          h: Math.max(1, image.height * scale),
        },
        randomUUID(),
      );
      node.name = file.name;
      node.parent = parentAt(node.bounds);
      node.kind = {
        type: "image",
        asset_id: image.id,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        rotation: 0,
        aspect_locked: true,
      };
      await edit([
        { op: "add_asset", asset: image },
        { op: "add", node },
      ]);
      setSelection([node.id]);
      setInspectorSection("Adjust");
      setInspectorOpen(false);
    } catch (cause) {
      session.setError(cause instanceof Error ? cause.message : "Image import failed.");
    }
  };
  return (
    <section
      className={`${styles.canvas} flex min-h-0 min-w-0 flex-1 flex-col`}
      aria-label={`${area === "photo" ? "Photo" : "Design"} editor`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div
          className={styles.tools}
          role="toolbar"
          aria-label={area === "photo" ? "Photo tools" : "Canvas tools"}
        >
          {tools
            .filter((item) => item.id === "select" || item.id === "pan")
            .map((item) => (
              <CanvasToolHint key={item.id} label={item.name}>
                <button
                  className={styles.tool}
                  aria-label={item.name}
                  aria-pressed={tool === item.id}
                  disabled={Boolean(editingText)}
                  onClick={() => setTool(item.id)}
                >
                  <item.icon />
                  <span>{item.name.split(" (")[0]}</span>
                </button>
              </CanvasToolHint>
            ))}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Add shape or text"
                  disabled={!canvasAvailable}
                />
              }
            >
              {tools
                .find((item) => item.id === tool && item.id !== "select" && item.id !== "pan")
                ?.name.split(" (")[0] ?? "Add"}
              <ChevronDown size={14} />
            </MenuTrigger>
            <MenuPopup>
              {tools
                .filter((item) => item.id !== "select" && item.id !== "pan")
                .map((item) => (
                  <MenuItem key={item.id} onClick={() => setTool(item.id)}>
                    <item.icon />
                    {item.name}
                  </MenuItem>
                ))}
            </MenuPopup>
          </Menu>
          <CanvasToolHint label="Import image">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Import image"
              disabled={!canvasAvailable}
              onClick={() => upload.current?.click()}
            >
              <ImagePlus /> Image
            </Button>
          </CanvasToolHint>
          <input
            ref={upload}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importImage(file);
              event.target.value = "";
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <CanvasToolHint label="Undo">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Undo"
              disabled={!canvasAvailable}
              onClick={() =>
                void session.write("artwork", artwork.revision, { type: "undo" }, { id: asset.id })
              }
            >
              <Undo2 />
            </Button>
          </CanvasToolHint>
          <CanvasToolHint label="Redo">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Redo"
              disabled={!canvasAvailable}
              onClick={() =>
                void session.write("artwork", artwork.revision, { type: "redo" }, { id: asset.id })
              }
            >
              <Redo2 />
            </Button>
          </CanvasToolHint>
          <CanvasToolHint label="Toggle layers">
            <Button
              size="icon-sm"
              variant={layersOpen ? "secondary" : "ghost"}
              aria-label="Toggle layers"
              aria-pressed={layersOpen}
              disabled={Boolean(editingText)}
              onClick={() => {
                setLayersOpen(!layersOpen);
                setInspectorOpen(false);
              }}
            >
              <Layers />
            </Button>
          </CanvasToolHint>

          {session.environmentId && !selected.length && !editingText && (
            <WorkOnStudio
              compact
              environmentId={session.environmentId}
              asset={asset}
              area={area}
              revision={artwork.revision}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!canvasAvailable}
            onClick={() => void exportFile("png")}
          >
            Export PNG
          </Button>
        </div>
      </div>
      {(session.error || session.query.error) && (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-4 py-2 text-sm text-destructive"
        >
          {session.error || session.query.error}
        </p>
      )}
      <div className={styles.canvasBody}>
        <aside
          className={`${styles.panel} ${styles.layers} ${!layersOpen ? styles.panelHidden : ""}`}
          aria-label="Layers"
        >
          <h2 className="px-2 py-2 text-xs font-medium text-muted-foreground">Layers</h2>
          {nodes
            .slice()
            .reverse()
            .map((node) => (
              <div
                key={node.id}
                className={`flex items-center gap-1 rounded-md ${selection.includes(node.id) ? "bg-accent" : ""}`}
              >
                <button
                  className="min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-xs outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={(event) => {
                    setSelection(
                      event.shiftKey ? [...new Set([...selection, node.id])] : [node.id],
                    );
                    if (
                      (event.currentTarget.closest<HTMLElement>('[aria-label="Studio"]')
                        ?.clientWidth ?? Infinity) <= 520
                    )
                      setLayersOpen(false);
                  }}
                >
                  {node.parent ? "↳ " : ""}
                  {node.name}
                </button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${node.visible ? "Hide" : "Show"} ${node.name}`}
                  disabled={!canvasAvailable}
                  onClick={() =>
                    void edit([{ op: "set_visible", id: node.id, visible: !node.visible }])
                  }
                >
                  {node.visible ? <Eye /> : <EyeOff />}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${node.locked ? "Unlock" : "Lock"} ${node.name}`}
                  disabled={!canvasAvailable}
                  onClick={() =>
                    void edit([{ op: "set_locked", id: node.id, locked: !node.locked }])
                  }
                >
                  {node.locked ? <Lock /> : <Unlock />}
                </Button>
              </div>
            ))}
        </aside>
        <div className={styles.stage}>
          <div ref={setTextControlsHost} className={styles.selectionHost}>
            {selected.length > 0 && !editingText && (
              <StudioSelectionBar
                nodes={selected}
                disabled={!available || !selected.every(editable)}
                cropActive={tool === "crop"}
                onEdit={edit}
                chatAction={
                  session.environmentId ? (
                    <WorkOnStudio
                      compact
                      environmentId={session.environmentId}
                      asset={asset}
                      area={area}
                      revision={artwork.revision}
                      selection={selection}
                    />
                  ) : null
                }
                onText={() => {
                  if (selected.length === 1) startText(selected[0]!.id);
                }}
                onProperties={(section) => {
                  if (section) setInspectorSection(section);
                  setInspectorOpen(section ? true : !inspectorOpen);
                  setLayersOpen(false);
                }}
                onCrop={() => {
                  setTool("crop");
                  setInspectorOpen(false);
                  setLayersOpen(false);
                }}
                onCancelCrop={() => setTool("select")}
              />
            )}
          </div>
          <svg
            ref={canvas}
            className={`min-h-0 w-full flex-1 touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${tool === "pan" || spacePan ? (gesture ? "cursor-grabbing" : "cursor-grab") : tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
            role="application"
            aria-label="Canvas. Scroll to pan, Ctrl or Command scroll to zoom, hold Space to drag. V selects, H pans, R draws a rectangle, O draws an ellipse, T adds text, P draws a path."
            tabIndex={0}
            viewBox={`${visibleView.x} ${visibleView.y} ${visibleView.w} ${visibleView.h}`}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={() => setGesture(null)}
            onKeyUp={(event) => {
              if (event.code === "Space") setSpacePan(false);
            }}
            onBlur={() => setSpacePan(false)}
            onDoubleClick={(event) => {
              if (!available || tool !== "select") return;
              const point = eventPoint(event);
              const hit = nodes
                .slice()
                .reverse()
                .find(
                  (node) =>
                    editable(node) &&
                    point.x >= node.bounds.x &&
                    point.x <= node.bounds.x + node.bounds.w &&
                    point.y >= node.bounds.y &&
                    point.y <= node.bounds.y + node.bounds.h,
                );
              if (hit?.kind.type !== "text") return;
              setSelection([hit.id]);
              startText(hit.id);
            }}
            onKeyDown={(event) => {
              if (editingText) return;
              if (event.code === "Space") {
                event.preventDefault();
                setSpacePan(true);
                return;
              }
              if (
                event.key === "Enter" &&
                available &&
                selected.length === 1 &&
                editable(selected[0]!) &&
                selected[0]!.kind.type === "text"
              ) {
                event.preventDefault();
                startText(selected[0]!.id);
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (available)
                  void session.write(
                    "artwork",
                    artwork.revision,
                    { type: event.shiftKey ? "redo" : "undo" },
                    { id: asset.id },
                  );
                return;
              }
              if ((event.key === "Delete" || event.key === "Backspace") && available) {
                event.preventDefault();
                void edit(selected.map((node) => ({ op: "delete", id: node.id })));
                return;
              }
              if (event.key === "Escape") {
                if (tool === "crop") {
                  setTool("select");
                  setGesture(null);
                  return;
                }
                setGesture(null);
                setSelection([]);
                setTool("select");
                return;
              }
              const shortcuts: Record<string, Tool> = {
                v: "select",
                h: "pan",
                f: "frame",
                r: "rectangle",
                o: "ellipse",
                t: "text",
                p: "pencil",
              };
              if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]!);
              const direction: Record<string, Point> = {
                ArrowLeft: { x: -1, y: 0 },
                ArrowRight: { x: 1, y: 0 },
                ArrowUp: { x: 0, y: -1 },
                ArrowDown: { x: 0, y: 1 },
              };
              const delta = direction[event.key];
              if (delta && available) {
                event.preventDefault();
                void edit(
                  selected.map((node) => ({
                    op: "set_bounds",
                    id: node.id,
                    bounds: {
                      ...node.bounds,
                      x: node.bounds.x + delta.x * (event.shiftKey ? 10 : 1),
                      y: node.bounds.y + delta.y * (event.shiftKey ? 10 : 1),
                    },
                  })),
                );
              }
            }}
          >
            {svg && (
              <image
                href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
                x={base.x}
                y={base.y}
                width={base.w}
                height={base.h}
                pointerEvents="none"
              />
            )}
            {selected.map((node) => {
              const moved = gesture?.tool === "select" && gesture.bounds[node.id];
              const bounds = moved
                ? gesture!.corner
                  ? resized(moved, gesture!, gesture!.point)
                  : {
                      ...moved,
                      x: moved.x + gesture!.point.x - gesture!.start.x,
                      y: moved.y + gesture!.point.y - gesture!.start.y,
                    }
                : node.bounds;
              return (
                <g key={node.id} pointerEvents="none">
                  <rect
                    data-studio-selection={node.id}
                    {...{ x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h }}
                    fill="none"
                    stroke="currentColor"
                    className={styles.selection}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={1.5}
                  />
                  {selected.length === 1 &&
                    available &&
                    (["nw", "ne", "sw", "se"] as const).map((corner) => (
                      <circle
                        key={corner}
                        cx={bounds.x + (corner.includes("e") ? bounds.w : 0)}
                        cy={bounds.y + (corner.includes("s") ? bounds.h : 0)}
                        r={visibleView.w / 160}
                        fill="currentColor"
                        className={styles.selection}
                      />
                    ))}
                </g>
              );
            })}
            {selected.length === 1 &&
              selected[0]!.kind.type === "path" &&
              tool === "select" &&
              !gesture && (
                <StudioCurveHandles
                  key={selected[0]!.id}
                  node={selected[0]!}
                  viewWidth={visibleView.w}
                  disabled={!canvasAvailable}
                  onEdit={edit}
                />
              )}
            {gesture && !["select", "pan", "hide", "restore"].includes(gesture.tool) && (
              <rect
                x={Math.min(gesture.start.x, gesture.point.x)}
                y={Math.min(gesture.start.y, gesture.point.y)}
                width={Math.max(1, Math.abs(gesture.point.x - gesture.start.x))}
                height={Math.max(1, Math.abs(gesture.point.y - gesture.start.y))}
                fill="currentColor"
                fillOpacity={0.15}
                stroke="currentColor"
                className={styles.selection}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {editingNode?.kind.type === "text" && (
              <StudioInlineText
                key={editingNode.id}
                node={editingNode}
                controlsHost={textControlsHost}
                readonly={!available || !liveEditingNode || !editable(editingNode)}
                missing={!liveEditingNode}
                onDone={finishText}
                onSave={async (content, original, overwrite) => {
                  if (!available || !editable(editingNode)) return false;
                  if (!overwrite && (editingNode.kind.content ?? "") !== original) {
                    session.setError("This text changed elsewhere. Your draft is kept.");
                    return false;
                  }
                  const result = await edit([
                    {
                      op: "set_text",
                      id: editingNode.id,
                      content,
                      size: editingNode.kind.size ?? 32,
                      font: editingNode.kind.font ?? "sans",
                    },
                  ]);
                  return result !== null;
                }}
              />
            )}
          </svg>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
            <StudioChatStatus
              environmentId={session.environmentId}
              assetId={asset.id}
              revision={artwork.revision}
              localStatus={
                session.busy
                  ? "Saving…"
                  : editingText
                    ? "Editing text"
                    : !session.connected
                      ? "Reconnecting…"
                      : undefined
              }
            />
            {available &&
              selected.length === 1 &&
              editable(selected[0]!) &&
              selected[0]!.kind.type === "text" && (
                <span className="hidden sm:inline">Enter to edit text</span>
              )}
            <div className="flex items-center gap-1">
              <CanvasToolHint label="Zoom out">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Zoom out"
                  onClick={() => zoom(1.25)}
                >
                  <ZoomOut />
                </Button>
              </CanvasToolHint>
              <Button
                size="xs"
                variant="ghost"
                aria-label="Fit canvas"
                onClick={() => setView(fittedView())}
              >
                {zoomPercent === null ? "Fit" : `${zoomPercent}%`}
              </Button>
              <CanvasToolHint label="Zoom in">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Zoom in"
                  onClick={() => zoom(0.8)}
                >
                  <ZoomIn />
                </Button>
              </CanvasToolHint>
            </div>
          </footer>
        </div>
        <aside
          className={`${styles.panel} ${styles.properties} ${sheetExpanded ? styles.sheetExpanded : ""} ${!inspectorOpen ? styles.panelHidden : ""}`}
          aria-label="Properties"
        >
          <div className={styles.inspectorHeading}>
            {selected.length === 1 ? (
              <Input
                key={selected[0]!.id + selected[0]!.name}
                aria-label="Layer name"
                unstyled
                defaultValue={selected[0]!.name}
                disabled={!available || !editable(selected[0]!)}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (name && name !== selected[0]!.name)
                    void edit([{ op: "rename", id: selected[0]!.id, name }]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            ) : (
              <span>{selected.length ? `${selected.length} selected` : "Canvas"}</span>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              data-studio-sheet-expand
              aria-label={sheetExpanded ? "Compact properties" : "Expand properties"}
              onClick={() => setSheetExpanded(!sheetExpanded)}
            >
              {sheetExpanded ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label="Close properties"
              onClick={() => setInspectorOpen(false)}
            >
              Done
            </Button>
          </div>
          <StudioInspector
            key={selected.map((node) => node.id).join(":")}
            nodes={selected}
            allNodes={nodes}
            area={area}
            disabled={!canvasAvailable || !selected.every(editable)}
            section={inspectorSection}
            onSectionChange={setInspectorSection}
            onEdit={edit}
            onTool={setTool}
            onExport={(kind) => exportFile(kind, true)}
            onCrop={(imageId, region) =>
              session.write("photo_crop", artwork.revision, { imageId, region }, { id: asset.id })
            }
          />
        </aside>
      </div>
    </section>
  );
}

function CanvasToolHint({
  label,
  children,
}: {
  label: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
