import * as clabUi from "@containerlab/clab-ui";

/** One pen stroke in flow coordinates, while it is being drawn or rendered for the agent. */
export interface Stroke {
  id: string;
  color: string;
  /** Brush diameter in flow units. */
  size: number;
  /** [x, y, pressure] per point. */
  points: Array<[number, number, number]>;
}

/** A stroke as clab-ui stores it: a free-shape annotation whose points are fractions (0..1) of its box. */
export interface FreehandAnnotation {
  id: string;
  shapeType: "freehand";
  position: { x: number; y: number };
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
  rotation: number;
  points: Array<[number, number]>;
}

interface FreehandApi {
  add: (annotation: FreehandAnnotation) => void;
  remove: (id: string) => void;
  persist: (client: unknown) => Promise<void>;
}

/** Added to clab-ui by patches/@containerlab+clab-ui+*+freehand-annotation.patch; absent if that patch did not apply. */
export const freehandApi = (clabUi as unknown as { freehand?: FreehandApi }).freehand;

type CanvasNode = ReturnType<typeof clabUi.useNodes>[number];

export const PEN_WIDTH = 3;
const MIN_BOX = 8;
/** Points closer than this (flow units) to the last kept one add nothing but file size. */
const MIN_STEP = 1.5;

export const isFreehand = (node: CanvasNode): boolean =>
  node.type === "free-shape-node" && (node.data as { shapeType?: unknown }).shapeType === "freehand";

export function strokeToAnnotation(stroke: Stroke): FreehandAnnotation {
  const kept = stroke.points.filter((point, i, all) => i === 0 || i === all.length - 1 || Math.hypot(point[0] - all[i - 1][0], point[1] - all[i - 1][1]) >= MIN_STEP);
  const xs = kept.map((p) => p[0]);
  const ys = kept.map((p) => p[1]);
  const pad = Math.max(stroke.size, 2);
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + 2 * pad, MIN_BOX);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + 2 * pad, MIN_BOX);
  // A straight horizontal or vertical stroke has no extent on one axis; centre it in the minimum box.
  const x0 = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
  const y0 = (Math.min(...ys) + Math.max(...ys)) / 2 - height / 2;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return {
    id: `freehand_${stroke.id}`,
    shapeType: "freehand",
    position: { x: x0, y: y0 },
    width,
    height,
    borderColor: stroke.color,
    borderWidth: PEN_WIDTH,
    rotation: 0,
    points: kept.map((p) => [round((p[0] - x0) / width), round((p[1] - y0) / height)]),
  };
}

export function annotationOfNode(node: CanvasNode): FreehandAnnotation {
  const data = node.data as Partial<FreehandAnnotation>;
  return {
    id: node.id,
    shapeType: "freehand",
    position: { ...node.position },
    width: node.width ?? data.width ?? MIN_BOX,
    height: node.height ?? data.height ?? MIN_BOX,
    borderColor: data.borderColor ?? "#1976d2",
    borderWidth: data.borderWidth ?? PEN_WIDTH,
    rotation: data.rotation ?? 0,
    points: data.points ?? [],
  };
}

/** The stroke in flow coordinates, for the picture the agent reads and for hit testing. */
export function strokeOfNode(node: CanvasNode): Stroke {
  const annotation = annotationOfNode(node);
  return {
    id: node.id,
    color: annotation.borderColor,
    size: annotation.borderWidth,
    points: annotation.points.map(([px, py]) => [annotation.position.x + px * annotation.width, annotation.position.y + py * annotation.height, 0.5]),
  };
}

export const distToStroke = (stroke: Stroke, x: number, y: number): number =>
  stroke.points.reduce((best, [px, py]) => Math.min(best, Math.hypot(px - x, py - y)), Infinity);
