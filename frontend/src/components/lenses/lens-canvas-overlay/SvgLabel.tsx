import { useTheme } from "@mui/material/styles";

import { LABEL_FONT_PX, LABEL_HEIGHT, LABEL_TEXT_X, labelWidth, type Point } from "./helpers";

// A floating pill that reads as part of the app rather than a hardcoded black
// box: it uses the live panel surface + divider tokens (so it inverts cleanly
// between light and dark), carries the category colour in a small leading dot
// instead of a loud full-width border, and lifts off the busy canvas with a
// soft drop shadow (see the shared filter in LensCanvasOverlay).
//
// Theme colours are applied via `style` rather than SVG presentation
// attributes: clab-ui's palette tokens are CSS `var(...)` strings, and var()
// only resolves in a CSS context — the same reason UnitPreview styles its SVG
// this way.
export function SvgLabel({ point, value, color, selected = false }: {
  point: Point;
  value: string;
  color: string;
  selected?: boolean;
}) {
  const theme = useTheme();
  const width = labelWidth(value);

  return (
    <g
      transform={`translate(${point.x - width / 2} ${point.y - LABEL_HEIGHT / 2})`}
      filter="url(#netlab-label-shadow)"
    >
      <rect
        width={width}
        height={LABEL_HEIGHT}
        rx={LABEL_HEIGHT / 2}
        style={{
          fill: theme.palette.background.paper,
          fillOpacity: 0.95,
          stroke: selected ? theme.palette.primary.main : theme.palette.divider,
          strokeWidth: selected ? 1.5 : 1,
        }}
      />
      <circle cx={12} cy={LABEL_HEIGHT / 2} r={3.5} style={{ fill: color }} />
      <text
        x={LABEL_TEXT_X}
        y={LABEL_HEIGHT / 2}
        dominantBaseline="central"
        style={{
          fill: theme.palette.text.primary,
          fontSize: LABEL_FONT_PX,
          fontWeight: selected ? 600 : 500,
          fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
        }}
      >
        {value}
      </text>
    </g>
  );
}
