import { useMemo, useRef } from "react";
import { useEdges } from "@containerlab/clab-ui";

import { useRuntimeContainers } from "../../../host/runtimeStore";
import { useCanvasGeometry } from "../useCanvasGeometry";
import { polylineMidpoint, visibleLabelIds } from "../lens-canvas-overlay/helpers";
import { SvgLabel } from "../lens-canvas-overlay/SvgLabel";
import { useEdgeTints } from "../lens-canvas-overlay/useEdgeTints";
import { EdgeTintStyles } from "../lens-canvas-overlay/EdgeTintStyles";
import type { EdgeTintMap } from "../lens-canvas-overlay/edgeBinding";
import { TRAFFIC_COLORS, linkLabel, linkTraffic, loadLevel, type LinkTraffic } from "./linkTraffic";

function tintFor(link: LinkTraffic): EdgeTintMap[string] | null {
  if (link.down) return { color: TRAFFIC_COLORS.down, width: 3, opacity: 0.9, dash: "6 5" };
  if (link.newErrors > 0) return { color: TRAFFIC_COLORS.errors, width: 4, opacity: 1 };
  if (!link.bps) return null;
  const level = loadLevel(link.bps);
  return { color: TRAFFIC_COLORS.load[level], width: 2.5 + level * 1.5, opacity: 0.95 };
}

function dotColor(link: LinkTraffic): string {
  if (link.down || link.newErrors > 0) return TRAFFIC_COLORS.errors;
  return TRAFFIC_COLORS.load[loadLevel(link.bps ?? 0)];
}

/** Live traffic on every link: width and colour by load, red for links that
 * are down or dropping/erroring right now, and a rate label on each busy one.
 * Refreshes with the runtime poll (every 3 s). */
export function TrafficCanvasOverlay({ container }: { container: HTMLElement }) {
  const containerRef = useRef<HTMLElement | null>(container);
  containerRef.current = container;
  const geometry = useCanvasGeometry(containerRef);
  const edges = useEdges();
  const containers = useRuntimeContainers();
  const links = useMemo(() => linkTraffic(edges, containers), [edges, containers]);

  const tints = useMemo(() => {
    const map: EdgeTintMap = {};
    for (const link of links) {
      const tint = tintFor(link);
      if (tint) map[link.edgeId] = tint;
    }
    return map;
  }, [links]);
  useEdgeTints(container, tints);

  const labels = useMemo(() => links.flatMap((link) => {
    const edge = geometry.edges[link.edgeId];
    if (!edge || (!link.bps && !link.down && link.newErrors === 0)) return [];
    const problem = link.down || link.newErrors > 0;
    return [{ id: link.edgeId, point: polylineMidpoint(edge.points), value: linkLabel(link), priority: problem ? 50 : (link.bps ?? 0) / 1e9, link }];
  }), [links, geometry.edges]);
  const visible = useMemo(() => visibleLabelIds(labels), [labels]);

  return (
    <>
    <EdgeTintStyles />
    <svg
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      aria-label="traffic topology lens"
      style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none", overflow: "hidden" }}
    >
      <defs>
        <filter id="netlab-label-shadow" x="-25%" y="-40%" width="150%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity={0.35} />
        </filter>
      </defs>
      {labels.filter((label) => visible.has(label.id)).map((label) => (
        <SvgLabel key={label.id} point={label.point} value={label.value} color={dotColor(label.link)} />
      ))}
    </svg>
    </>
  );
}
