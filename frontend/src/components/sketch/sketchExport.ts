import { getStroke } from "perfect-freehand";

import { getApiBase } from "../../api/endpoint";
import type { Stroke } from "../../host/sketchStore";

export interface SketchNode { id: string; x: number; y: number; width: number; height: number }

const PAD = 40;
const MAX_SIDE = 1600;

/** The sketch as the agent should see it: white page, existing nodes as labelled grey boxes, the pen on top. */
export async function renderSketch(strokes: Stroke[], nodes: SketchNode[]): Promise<{ png: Blob; width: number; height: number }> {
  const xs = [...strokes.flatMap((s) => s.points.map((p) => p[0])), ...nodes.flatMap((n) => [n.x, n.x + n.width])];
  const ys = [...strokes.flatMap((s) => s.points.map((p) => p[1])), ...nodes.flatMap((n) => [n.y, n.y + n.height])];
  const minX = Math.min(...xs) - PAD, minY = Math.min(...ys) - PAD;
  const spanX = Math.max(...xs) + PAD - minX, spanY = Math.max(...ys) + PAD - minY;
  const scale = Math.min(1, MAX_SIDE / Math.max(spanX, spanY));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(spanX * scale));
  canvas.height = Math.max(1, Math.round(spanY * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas is not available");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);

  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const node of nodes) {
    ctx.fillStyle = "#e0e0e0";
    ctx.strokeStyle = "#9e9e9e";
    ctx.fillRect(node.x, node.y, node.width, node.height);
    ctx.strokeRect(node.x, node.y, node.width, node.height);
    ctx.fillStyle = "#212121";
    ctx.fillText(node.id, node.x + node.width / 2, node.y + node.height / 2, node.width);
  }
  for (const stroke of strokes) {
    const outline = getStroke(stroke.points, { size: stroke.size, thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: false });
    if (outline.length < 2) continue;
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("could not render the sketch");
  return { png, width: canvas.width, height: canvas.height };
}

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** Saves the rendered sketch in the lab's folder and returns the PNG's path on the backend machine. */
export async function uploadSketch(sessionId: string, strokes: Stroke[], nodes: SketchNode[]): Promise<string> {
  const { png } = await renderSketch(strokes, nodes);
  const response = await fetch(`${getApiBase()}/api/assistant/sketch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      imageBase64: await toBase64(png),
      strokes: strokes.map(roundStroke),
      nodes,
    }),
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { detail?: string } | null)?.detail ?? response.statusText);
  return ((await response.json()) as { path: string }).path;
}

const strokesUrl = (sessionId: string) => `${getApiBase()}/api/assistant/sketch/strokes`.concat(`?sessionId=${encodeURIComponent(sessionId)}`);

export async function loadStrokes(sessionId: string): Promise<Stroke[]> {
  const response = await fetch(strokesUrl(sessionId));
  if (!response.ok) return [];
  return ((await response.json()) as { strokes?: Stroke[] }).strokes ?? [];
}

export async function saveStrokes(sessionId: string, strokes: Stroke[]): Promise<void> {
  await fetch(`${getApiBase()}/api/assistant/sketch/strokes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, strokes: strokes.map(roundStroke) }),
  });
}

const roundStroke = (s: Stroke): Stroke => ({ ...s, points: s.points.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]) });
