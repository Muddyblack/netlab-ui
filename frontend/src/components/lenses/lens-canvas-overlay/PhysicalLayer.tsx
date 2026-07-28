import type { LensBundleResult } from "../../../api/client";
import type { CanvasGeometry } from "../useCanvasGeometry";
import { ORIGIN_COLOR, SELECTION_COLOR } from "./helpers";

interface PhysicalLayerProps {
  bundle: LensBundleResult;
  geometry: CanvasGeometry;
  selectedRef: string | null;
}

// #2 selection ring: drawn in the overlay we own so selection reads on its own
// cool-cyan channel instead of leaning on the host editor's warm highlight.
function SelectionRing({ node }: { node: { x: number; y: number; width: number; height: number } }) {
  const pad = 6;
  return (
    <rect
      x={node.x - pad}
      y={node.y - pad}
      width={node.width + pad * 2}
      height={node.height + pad * 2}
      rx={12}
      fill="none"
      stroke={SELECTION_COLOR}
      strokeWidth={2.5}
      style={{ filter: "drop-shadow(0 0 6px rgba(79,195,255,0.55))" }}
    />
  );
}

export function PhysicalLayer({ bundle, geometry, selectedRef }: PhysicalLayerProps) {
  const selectedNode = selectedRef?.startsWith("node:") ? selectedRef.slice(5) : null;
  const selectedGeometry = selectedNode ? geometry.nodes[selectedNode] : undefined;

  return (
    <>
      {selectedGeometry && <SelectionRing node={selectedGeometry} />}

      {bundle.derivation.nodes.map((row) => {
        const node = geometry.nodes[row.node];
        const total = row.authored + row.inherited + row.computed;
        if (!node || total === 0) return null;
        const width = node.width;
        const x = node.x;
        const y = node.y + node.height + 5;
        const segments = [
          { value: row.authored, color: ORIGIN_COLOR.authored },
          { value: row.inherited, color: ORIGIN_COLOR.inherited },
          { value: row.computed, color: ORIGIN_COLOR.computed },
        ];
        let offset = 0;
        return (
          <g key={`derivation:${row.node}`}>
            {segments.map((segment, index) => {
              const segWidth = (segment.value / total) * width;
              const rect = (
                <rect key={index} x={x + offset} y={y} width={segWidth} height={4} rx={1.5} fill={segment.color} fillOpacity={0.9} />
              );
              offset += segWidth;
              return rect;
            })}
          </g>
        );
      })}
    </>
  );
}
