import { GlobalStyles } from "@mui/material";

import { TINTED_EDGE_CLASS } from "./useEdgeTints";

/** The one CSS rule that makes useEdgeTints' custom properties visible. The
 * lens colour rides on the edge React Flow already drew. `!important` is
 * required, not lazy: React Flow sets the stroke inline on the path, so a
 * plain rule of ours would always lose. */
export function EdgeTintStyles() {
  return (
    <GlobalStyles styles={{
      [`.${TINTED_EDGE_CLASS} .react-flow__edge-path`]: {
        stroke: "var(--netlab-lens-color) !important",
        strokeWidth: "var(--netlab-lens-width) !important",
        strokeOpacity: "var(--netlab-lens-opacity) !important",
        strokeDasharray: "var(--netlab-lens-dash) !important",
        transition: "stroke 180ms ease, stroke-width 180ms ease",
      },
    }} />
  );
}
