import type { CanvasGeometry } from "../useCanvasGeometry";
import { VALIDATION_COLORS, validationGlyph } from "./helpers";

interface ValidationLayerProps {
  geometry: CanvasGeometry;
  nodeValidationState: Record<string, string>;
}

export function ValidationLayer({ geometry, nodeValidationState }: ValidationLayerProps) {
  return (
    <>
      {Object.entries(nodeValidationState).map(([nodeName, testState]) => {
        const node = geometry.nodes[nodeName];
        if (!node) return null;
        const color = VALIDATION_COLORS[testState] ?? VALIDATION_COLORS.unknown;
        const glyph = validationGlyph(testState);
        return (
          <g key={`validation:${nodeName}`}>
            <circle cx={node.x + node.width + 4} cy={node.y + 4} r={9} fill={color} stroke="rgba(15,15,15,.85)" strokeWidth={1.5} />
            <text x={node.x + node.width + 4} y={node.y + 8} textAnchor="middle" fill="#fff" fontSize={12} fontWeight={700} fontFamily="Roboto, sans-serif">{glyph}</text>
          </g>
        );
      })}
    </>
  );
}
