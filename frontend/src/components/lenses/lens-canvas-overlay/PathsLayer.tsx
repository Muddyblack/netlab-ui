import type { PathResult } from "../../../api/client";
import type { CanvasGeometry } from "../useCanvasGeometry";
import { center, interpolate, PATH_COLORS } from "./helpers";
import { SvgLabel } from "./SvgLabel";

interface PathsLayerProps {
  geometry: CanvasGeometry;
  pathResult: PathResult | null;
}

export function PathsLayer({ geometry, pathResult }: PathsLayerProps) {
  return (
    <>
      {pathResult?.reachable && pathResult.hops.map((hop) => {
        const from = center(geometry.nodes[hop.fromNode]);
        const to = center(geometry.nodes[hop.toNode]);
        if (!from || !to) return null;
        const mid = interpolate(from, to, 0.5);
        return (
          <g key={`path:${hop.order}`}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={PATH_COLORS.flow} strokeWidth={7} strokeOpacity={0.2} strokeLinecap="round" />
            <line
              className="netlab-path-flow"
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={PATH_COLORS.flow}
              strokeWidth={3}
              strokeDasharray="10 14"
              strokeLinecap="round"
            />
            <circle cx={mid.x} cy={mid.y} r={9} fill={PATH_COLORS.hop} stroke="rgba(15,15,15,.85)" strokeWidth={1.5} />
            <text x={mid.x} y={mid.y + 4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={700} fontFamily="Roboto, sans-serif">{hop.order}</text>
          </g>
        );
      })}

      {pathResult && ["source", "target"].map((role) => {
        const nodeName = role === "source" ? pathResult.source : pathResult.target;
        const node = geometry.nodes[nodeName];
        if (!node || pathResult.source === pathResult.target) return null;
        return (
          <SvgLabel
            key={`pathend:${role}`}
            point={{ x: node.centerX, y: node.y - 12 }}
            value={role === "source" ? "SRC" : "DST"}
            color={pathResult.reachable ? PATH_COLORS.flow : PATH_COLORS.blocked}
            selected
          />
        );
      })}
    </>
  );
}
