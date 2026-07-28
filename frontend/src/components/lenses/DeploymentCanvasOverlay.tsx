import { Box, GlobalStyles } from "@mui/material";
import { useMemo, useRef } from "react";

import type { DeploymentOverview } from "../../api/client";
import { useCanvasGeometry, type CanvasNodeGeometry } from "./useCanvasGeometry";

const STATE_COLORS: Record<string, string> = {
  queued: "#94a3b8",
  creating: "#38bdf8",
  configuring: "#f59e0b",
  ready: "#22c55e",
  failed: "#ef4444",
  stopping: "#a78bfa",
  stopped: "#64748b",
};

function nodeOutline(node: CanvasNodeGeometry): string {
  const pad = 4;
  const x = node.x - pad;
  const y = node.y - pad;
  const width = node.width + pad * 2;
  const height = node.height + pad * 2;
  return `M${x},${y}h${width}v${height}h-${width}Z`;
}

interface DeploymentCanvasOverlayProps {
  container: HTMLElement;
  nodeStates: DeploymentOverview["nodes"];
}

/**
 * Draw deployment state as at most seven SVG paths, regardless of node count.
 * Nodes with the same state share one path instead of creating a React/SVG
 * element per node, which keeps the overlay cheap for very large topologies.
 */
export function DeploymentCanvasOverlay({ container, nodeStates }: DeploymentCanvasOverlayProps) {
  const containerRef = useRef<HTMLElement | null>(container);
  containerRef.current = container;
  const geometry = useCanvasGeometry(containerRef);
  const paths = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const [nodeName, state] of Object.entries(nodeStates)) {
      const node = geometry.nodes[nodeName];
      if (!node) continue;
      (grouped[state] ??= []).push(nodeOutline(node));
    }
    return Object.entries(grouped).map(([state, segments]) => ({ state, path: segments.join("") }));
  }, [geometry.nodes, nodeStates]);

  return (
    <>
      <GlobalStyles styles={{
        "@keyframes netlab-deployment-flow": { to: { strokeDashoffset: -26 } },
        ".netlab-deployment-flow": { animation: "netlab-deployment-flow 900ms linear infinite" },
      }} />
      <Box
        component="svg"
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        aria-label="deployment topology lens"
        sx={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none", overflow: "hidden" }}
      >
        {paths.map(({ state, path }) => (
          <path
            key={state}
            d={path}
            fill="none"
            stroke={STATE_COLORS[state] ?? STATE_COLORS.queued}
            strokeWidth={state === "failed" ? 4 : 3}
            strokeOpacity={state === "stopped" ? 0.55 : 0.9}
            strokeDasharray={state === "configuring" ? "8 5" : undefined}
            className={state === "configuring" ? "netlab-deployment-flow" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>
    </>
  );
}
