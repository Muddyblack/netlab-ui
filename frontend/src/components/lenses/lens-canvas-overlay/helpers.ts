import type { LensBundleResult } from "../../../api/client";
import type { CanvasNodeGeometry } from "../useCanvasGeometry";
import type { RoutingLayer } from "./types";

export interface Point {
  x: number;
  y: number;
}

// Curated categorical palette. This replaces the previous random-hash HSL
// colours, whose arbitrary clashing hues were the main reason the overlay read
// as unpolished. Keys map to a stable slot and the hues stay legible on both
// the light and dark canvas.
export const CATEGORY_PALETTE = [
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#10b981", // emerald
  "#f97316", // orange
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#e11d48", // rose
] as const;

// Derivation provenance legend — the single source of truth shared by the
// canvas overlay (PhysicalLayer) and the side-panel DerivationInspector, so the
// two never drift apart. Blue = authored, purple = inherited, green = computed.
export const ORIGIN_COLOR: Record<string, string> = {
  authored: "#42a5f5",
  inherited: "#ab47bc",
  computed: "#66bb6a",
};

// Selection lives in its own channel — a cool cyan ring that never competes
// with the warm device orange the way a same-hue highlight would.
export const SELECTION_COLOR = "#4fc3ff";

export const PROTOCOL_COLORS: Record<RoutingLayer, string> = {
  bgp: "#f59e0b",
  ospf: "#3b82f6",
  isis: "#8b5cf6",
  bfd: "#14b8a6",
  evpn: "#ec4899",
};

export const VALIDATION_COLORS: Record<string, string> = {
  passed: "#22c55e",
  failed: "#ef4444",
  warning: "#f59e0b",
  unknown: "#94a3b8",
};

// Path trace accent — a harmonised cyan from the same family as the palette,
// replacing the old neon #00e5ff/#00acc1 that made the Paths lens look unrelated
// to everything else. Shared by the canvas layer and the side-panel hop list.
export const PATH_COLORS = {
  flow: "#06b6d4",
  hop: "#0891b2",
  blocked: "#ef4444",
};

export function strokeWidthFor(selected: boolean, protocol: RoutingLayer): number {
  if (selected) return 5;
  return protocol === "evpn" ? 4 : 3;
}

export function validationGlyph(state: string): string {
  if (state === "passed") return "✓";
  if (state === "failed") return "✕";
  if (state === "warning") return "!";
  return "·";
}

export function colorFor(key: string): string {
  let hash = 0;
  for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

export function center(node: CanvasNodeGeometry | undefined): Point | null {
  return node ? { x: node.centerX, y: node.centerY } : null;
}

export function interpolate(left: Point, right: Point, amount: number): Point {
  return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount };
}

/**
 * Shift a polyline sideways by `offset` px along its local normal and return it
 * as an SVG path. This is what lets several routing protocols share one physical
 * link: each adjacency rides as a parallel ribbon that follows the real edge's
 * curve instead of a straight chord drawn across it. Offset 0 traces the edge
 * exactly.
 */
export function offsetPath(points: Point[], offset: number): string {
  if (points.length < 2) return "";
  const shifted = points.map((point, index) => {
    // Average the direction of the segments on either side so the ribbon bends
    // smoothly through interior samples instead of stepping at each joint.
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (!length) return point;
    return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
  });
  return shifted.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

/** Point at the middle of a sampled polyline, for anchoring a ribbon's label. */
export function polylineMidpoint(points: Point[], offset = 0): Point {
  if (!points.length) return { x: 0, y: 0 };
  const index = Math.floor(points.length / 2);
  const point = points[index];
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.hypot(dx, dy);
  if (!length || !offset) return point;
  return { x: point.x - (dy / length) * offset, y: point.y + (dx / length) * offset };
}

/**
 * Symmetric offsets for `count` ribbons sharing one link, centred on the edge:
 * one ribbon traces the link exactly, two straddle it, three put one on the line
 * and one either side.
 */
export function ribbonOffsets(count: number, spacing = 5): number[] {
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing);
}

// Andrew's monotone-chain convex hull, counter-clockwise. Feeds the routing
// lens domain "bubbles" (one blob per AS / OSPF area / IS-IS area).
export function convexHull(points: Point[]): Point[] {
  if (points.length <= 2) return [...points];
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export interface LabelCandidate {
  id: string;
  point: Point;
  value: string;
  priority: number;
}

// Greedy label decluttering shared by the addressing and control-plane layers:
// higher-priority labels claim canvas space first and later overlapping ones
// are suppressed. Priority >= 100 (the selection) always keeps its label.
export function visibleLabelIds(candidates: LabelCandidate[]): Set<string> {
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const visible = new Set<string>();
  for (const candidate of [...candidates].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))) {
    const halfWidth = labelWidth(candidate.value) / 2 + 4;
    const halfHeight = LABEL_HEIGHT / 2 + 5;
    const bounds = {
      left: candidate.point.x - halfWidth,
      right: candidate.point.x + halfWidth,
      top: candidate.point.y - halfHeight,
      bottom: candidate.point.y + halfHeight,
    };
    const overlaps = occupied.some((other) => (
      bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top
    ));
    if (!overlaps || candidate.priority >= 100) {
      visible.add(candidate.id);
      occupied.push(bounds);
    }
  }
  return visible;
}

// Pill label geometry, shared by SvgLabel (rendering) and the addressing
// collision filter (decluttering) so both agree on a label's footprint. The
// width is measured from real font metrics via a shared offscreen canvas
// instead of a per-character guess, so pills hug the text instead of leaving
// ragged padding.
export const LABEL_FONT_PX = 12;
export const LABEL_HEIGHT = 24;
export const LABEL_TEXT_X = 22; // left padding + colour dot + gap before text
const LABEL_PADDING_RIGHT = 11;
const LABEL_FONT = `500 ${LABEL_FONT_PX}px "Roboto", "Helvetica", "Arial", sans-serif`;

let measureContext: CanvasRenderingContext2D | null | undefined;

function measureText(value: string): number {
  if (measureContext === undefined) {
    measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return value.length * LABEL_FONT_PX * 0.6;
  measureContext.font = LABEL_FONT;
  return measureContext.measureText(value).width;
}

export function labelWidth(value: string): number {
  return Math.ceil(measureText(value) + LABEL_TEXT_X + LABEL_PADDING_RIGHT);
}

function addressingObjectIds(bundle: LensBundleResult, ref: string): { nodeIds: string[]; edgeIds: string[] } {
  const segment = bundle.addressing.segments.find((item) => item.id === ref);
  const adjacency = bundle.controlPlane.adjacencies.find((item) => item.id === ref);
  const source = segment ?? adjacency;
  return { nodeIds: source?.nodeIds ?? [], edgeIds: source?.physicalEdgeIds ?? [] };
}

// Service refs (vlan:<name> / vrf:<name>) isolate every member node+edge.
function serviceObjectIds(bundle: LensBundleResult, ref: string): { nodeIds: string[]; edgeIds: string[] } {
  const name = ref.slice(ref.indexOf(":") + 1);
  if (ref.startsWith("vlan:")) {
    const vlan = bundle.serviceExplorer.vlans.find((item) => item.name === name);
    return { nodeIds: vlan?.nodeIds ?? [], edgeIds: vlan?.physicalEdgeIds ?? [] };
  }
  const vrf = bundle.serviceExplorer.vrfs.find((item) => item.name === name);
  return { nodeIds: vrf?.nodeIds ?? [], edgeIds: [] };
}

export function resolvePresentationObjects(bundle: LensBundleResult, refs: string[]) {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  refs.forEach((ref) => {
    if (ref.startsWith("node:")) nodes.add(ref.slice(5));
    const isService = ref.startsWith("vlan:") || ref.startsWith("vrf:");
    const { nodeIds, edgeIds } = isService ? serviceObjectIds(bundle, ref) : addressingObjectIds(bundle, ref);
    nodeIds.forEach((node) => nodes.add(node));
    edgeIds.forEach((edge) => edges.add(edge));
  });
  return { nodes, edges };
}
