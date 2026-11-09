import type { StudioArea, StudioMutationInput } from "@t3tools/contracts";
export type Json = StudioMutationInput["payload"];
export function jsonRecord(value: unknown): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}
export type Bounds = { x: number; y: number; w: number; h: number };
export type Color = [number, number, number, number];
export type Point = { x: number; y: number };
export type Pose = {
  translation: [number, number];
  rotation: number;
  scale: [number, number];
  opacity: number;
};
export type Joint = {
  id: string;
  name: string;
  parent: string | null;
  layer: string | null;
  size: [number, number];
  pivot: [number, number];
  rest: Pose;
};
export type Rig = { id: string; size: [number, number]; joints: Joint[] };
export type Keyframe = {
  id: string;
  frame: number;
  pose: Pose;
  timing: "linear" | "stepped" | "eased";
};
export type Animation = { rig: Rig; tracks: { joint: string; keys: Keyframe[] }[] };
export type Anchor = {
  point: Point;
  incoming: Point;
  outgoing: Point;
  mode?: "corner" | "smooth" | "symmetric";
};
export type Mask = {
  enabled: boolean;
  inverted: boolean;
  base_visible: boolean;
  feather: number;
  expansion: number;
  base_asset: string | null;
  space?: Bounds | null;
  strokes: { restore: boolean; opacity: number; radius: number; points: Point[] }[];
};
export type Node = {
  id: string;
  name: string;
  parent: string | null;
  bounds: Bounds;
  fill: Color;
  visible: boolean;
  locked: boolean;
  extra_contours?: { points: Anchor[]; closed: boolean }[];
  corner_radius?: number;
  kind: {
    type: string;
    content?: string;
    size?: number;
    font?: "sans" | "serif" | "mono";
    asset_id?: string;
    crop?: Bounds;
    rotation?: number;
    aspect_locked?: boolean;
    points?: Anchor[];
    closed?: boolean;
    stroke?: Color;
    stroke_width?: number;
  };
  mask?: Mask | null;
  text_style?: Json;
  gradient?: Json;
  stroke?: Json;
  auto_layout?: Json;
  main_component?: boolean;
  instance?: Json;
  adjustments?: {
    brightness: number;
    contrast: number;
    saturation: number;
    warmth: number;
    tint: number;
  };
  appearance?: { opacity: number; blend: string };
};
export type Artwork = {
  revision: number;
  head: string;
  document: { id: string; title: string; nodes: Node[] };
};
export type ArtworkPin = {
  asset: string;
  document: string;
  snapshot: string;
  frame: string | null;
};
export type Placement = {
  id: string;
  name: string;
  artwork: ArtworkPin;
  bounds: Bounds;
  rotation: number;
  locked: boolean;
  animation?: Json;
};
export type Shot = {
  id: string;
  title: string;
  description: string;
  duration_ms: number;
  artwork: ArtworkPin | null;
  composition?: {
    width: number;
    height: number;
    background: Color;
    placements: Placement[];
  } | null;
};
export type Story = {
  id: string;
  premise: string;
  world: string;
  characters: {
    id: string;
    name: string;
    notes: string;
    artwork: ArtworkPin | null;
    rig?: Rig | null;
  }[];
  scenes: { id: string; title: string; script: string; shots: Shot[] }[];
};
export type Sequence = {
  id: string;
  width: number;
  height: number;
  frame_rate: { numerator: number; denominator: number };
  shots: { id: string; name: string; frames: number; camera: Json; source: Json }[];
  audio: Json[];
};
export type Asset = {
  id: string;
  name: string;
  starred: boolean;
  content:
    | { type: "artwork"; document: string; source?: string | null }
    | { type: "story"; story: Story }
    | { type: "motion"; sequence: Sequence }
    | { type: "note" | "script"; body: string }
    | { type: "reference"; path: string }
    | { type: "audio"; media: Json };
};
export type Catalog = {
  revision: number;
  studio: {
    id: string;
    projects: { id: string; name: string }[];
    assets: Asset[];
    workspaces: { id: string; project: string; kind: StudioArea }[];
    workspace_items: { id: string; workspace: string; asset: string }[];
    trash?: { projects?: string[]; folders?: string[]; assets?: string[] };
  };
};
export type LiveSource = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  transform: { bounds: Bounds; rotation: number; opacity: number };
  content: {
    kind: string;
    color?: Color;
    text?: string;
    size?: number;
    font?: string;
    asset?: string;
  };
};
export type LiveScene = {
  id: string;
  name: string;
  background: Color;
  sources: LiveSource[];
  audio: { tone_hz: number | null; gain: number; muted: boolean };
};
export type LiveCollection = {
  id: string;
  revision: number;
  name: string;
  width: number;
  height: number;
  program: string;
  scenes: LiveScene[];
  images: { id: string; width: number; height: number; png_base64: string }[];
};
export const studioJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
export const colorHex = (color: Color) =>
  "#" +
  color
    .slice(0, 3)
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");
export const hexColor = (hex: string, alpha = 255): Color => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  alpha,
];
export function nodeFor(type: string, bounds: Bounds, id: string): Node {
  return {
    id,
    name: type === "text" ? "Text" : type[0]!.toUpperCase() + type.slice(1),
    parent: null,
    bounds,
    fill:
      type === "frame"
        ? [250, 249, 247, 255]
        : type === "text"
          ? [35, 32, 40, 255]
          : [180, 160, 210, 255],
    visible: true,
    locked: false,
    kind: type === "text" ? { type, content: "Text", size: 32, font: "sans" } : { type },
  };
}
