import { useMemo } from "react";
import { useTheme } from "@mui/material";
import type { UnitInfo, UnitNode } from "../panels/UnitsDock";

/** Deterministic warm accents so previews hint at device differences while
 * staying inside Netlab's orange/gold retro palette. */
const DEVICE_HUES = [28, 42, 18, 50, 8, 34, 2, 56];
function deviceHue(device?: string): number {
  if (!device) return 32;
  let h = 0;
  for (let i = 0; i < device.length; i++) h = (h * 31 + device.charCodeAt(i)) >>> 0;
  return DEVICE_HUES[h % DEVICE_HUES.length];
}

// Matches the backend's placement spacing (services/units.py) so a preview is
// a faithful miniature of what a drop onto the canvas will produce.
const SPACING = 140;

interface Pt {
  x: number;
  y: number;
}
interface Scene {
  nodes: { x: number; y: number; hue: number }[];
  links: [Pt, Pt][];
  /** Bounding frame per included child instance, to show the grouping. */
  frames: { x: number; y: number; w: number; h: number }[];
}

/** The unit's own nodes as offsets from their bounding-box top-left; nodes
 * without saved coordinates fall into a row below the placed ones. */
function ownLayout(unit: UnitInfo): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const nodes = unit.nodes || [];
  const placed = nodes.filter(
    (n): n is UnitNode & { x: number; y: number } => typeof n.x === "number" && typeof n.y === "number"
  );
  if (placed.length) {
    const minX = Math.min(...placed.map((n) => n.x));
    const minY = Math.min(...placed.map((n) => n.y));
    for (const n of placed) out.set(n.name, { x: n.x - minX, y: n.y - minY });
  }
  let floor = placed.length ? Math.max(...[...out.values()].map((p) => p.y)) + SPACING : 0;
  let col = 0;
  for (const n of nodes) {
    if (!out.has(n.name)) out.set(n.name, { x: col++ * SPACING, y: floor });
  }
  return out;
}

/** (width, height) one instance occupies, children included. */
function footprint(units: Record<string, UnitInfo>, name: string, stack: string[]): { w: number; h: number } {
  const unit = units[name];
  if (!unit || stack.includes(name)) return { w: 0, h: 0 };
  const own = [...ownLayout(unit).values()];
  const w = Math.max(...own.map((p) => p.x), -SPACING) + SPACING;
  const h = Math.max(...own.map((p) => p.y), -SPACING) + SPACING;
  let childW = 0;
  let childH = 0;
  for (const ref of unit.includes || []) {
    const f = footprint(units, ref.template, [...stack, name]);
    childW += (f.w + SPACING) * Math.max(1, Number(ref.count) || 1);
    childH = Math.max(childH, f.h);
  }
  return { w: Math.max(w, childW), h: h + (childH ? childH + SPACING : 0) };
}

/** Place one instance of `name` at (ox, oy), recursing into includes — the
 * same walk the backend does when computing drop positions. */
function placeInstance(
  units: Record<string, UnitInfo>,
  name: string,
  ox: number,
  oy: number,
  scene: Scene,
  stack: string[]
): void {
  const unit = units[name];
  if (!unit || stack.includes(name)) return;
  const own = ownLayout(unit);
  for (const n of unit.nodes || []) {
    const p = own.get(n.name)!;
    scene.nodes.push({ x: ox + p.x, y: oy + p.y, hue: deviceHue(n.device) });
  }
  for (const link of unit.links || []) {
    const pts = (link.endpoints || []).map((e: string) => own.get(e));
    if (pts.length >= 2 && pts.every(Boolean)) {
      scene.links.push([
        { x: ox + pts[0]!.x, y: oy + pts[0]!.y },
        { x: ox + pts[1]!.x, y: oy + pts[1]!.y }
      ]);
    }
  }
  const childY = oy + Math.max(...[...own.values()].map((p) => p.y), -SPACING) + 2 * SPACING;
  let childX = ox;
  for (const ref of unit.includes || []) {
    const count = Math.max(1, Number(ref.count) || 1);
    for (let j = 0; j < count; j++) {
      const f = footprint(units, ref.template, [...stack, name]);
      if (f.w > 0) {
        scene.frames.push({ x: childX - SPACING / 2, y: childY - SPACING / 2, w: f.w, h: f.h });
        placeInstance(units, ref.template, childX, childY, scene, [...stack, name]);
      }
      childX += f.w + SPACING;
    }
  }
}

interface UnitPreviewProps {
  unit: UnitInfo;
  /** All units by name, so included child units render with their real contents. */
  unitsByName?: Record<string, UnitInfo>;
  width?: number;
  height?: number;
}

/** Tiny SVG miniature of a unit: its nodes at their saved canvas positions,
 * internal links, and included child units rendered recursively inside a
 * subtle frame — so a "room of 4 workstations" looks like one. */
export function UnitPreview({ unit, unitsByName, width = 96, height = 60 }: UnitPreviewProps) {
  const theme = useTheme();

  const scene = useMemo(() => {
    const units = { ...(unitsByName || {}), [unit.name]: unit };
    const raw: Scene = { nodes: [], links: [], frames: [] };
    placeInstance(units, unit.name, 0, 0, raw, []);
    if (!raw.nodes.length && !raw.frames.length) return null;

    const xs = [
      ...raw.nodes.map((n) => n.x),
      ...raw.frames.flatMap((f) => [f.x, f.x + f.w])
    ];
    const ys = [
      ...raw.nodes.map((n) => n.y),
      ...raw.frames.flatMap((f) => [f.y, f.y + f.h])
    ];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);

    const pad = 7;
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 0.35);
    const offX = (width - spanX * scale) / 2 - minX * scale;
    const offY = (height - spanY * scale) / 2 - minY * scale;
    const tx = (x: number) => x * scale + offX;
    const ty = (y: number) => y * scale + offY;

    return {
      nodes: raw.nodes.map((n) => ({ x: tx(n.x), y: ty(n.y), hue: n.hue })),
      links: raw.links.map(([a, b]) => [
        { x: tx(a.x), y: ty(a.y) },
        { x: tx(b.x), y: ty(b.y) }
      ]),
      frames: raw.frames.map((f) => ({ x: tx(f.x), y: ty(f.y), w: f.w * scale, h: f.h * scale }))
    };
  }, [unit, unitsByName, width, height]);

  // Theme palette values may be CSS variables (var(--vscode-…)), which SVG
  // presentation attributes don't resolve and MUI's color utils can't parse —
  // so colors go through `style` and transparency through *-opacity.
  const dark = theme.palette.mode === "dark";
  const nodeR = Math.max(2.5, Math.min(4, width / 28));

  if (!scene) {
    return (
      <svg width={width} height={height} aria-hidden>
        <rect
          x={1}
          y={1}
          width={width - 2}
          height={height - 2}
          rx={4}
          style={{ fill: "none", stroke: theme.palette.divider, strokeDasharray: "4 3" }}
        />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} aria-hidden>
      {scene.frames.map((f, i) => (
        <rect
          key={`f${i}`}
          x={f.x}
          y={f.y}
          width={Math.max(f.w, 10)}
          height={Math.max(f.h, 8)}
          rx={3}
          style={{
            fill: theme.palette.primary.main,
            fillOpacity: dark ? 0.1 : 0.06,
            stroke: theme.palette.primary.main,
            strokeOpacity: 0.45,
            strokeWidth: 1,
            strokeDasharray: "3 2"
          }}
        />
      ))}
      {scene.links.map(([a, b], i) => (
        <line
          key={`l${i}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          style={{ stroke: theme.palette.text.secondary, strokeOpacity: 0.5, strokeWidth: 1 }}
        />
      ))}
      {scene.nodes.map((n, i) => (
        <circle
          key={`n${i}`}
          cx={n.x}
          cy={n.y}
          r={nodeR}
          fill={`hsl(${n.hue} ${dark ? "78%" : "72%"} ${dark ? "60%" : "44%"})`}
          style={{ stroke: theme.palette.background.paper, strokeWidth: 1 }}
        />
      ))}
    </svg>
  );
}
