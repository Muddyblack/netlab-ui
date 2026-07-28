import { Chip, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { useMemo } from "react";

import { collapseNodeSet } from "./nodeset";

interface NodeSetChipsProps {
  names: string[];
  /** Called with the concrete node name when a single-node chip is clicked. */
  onSelect?: (name: string) => void;
  variant?: "filled" | "outlined";
  sx?: SxProps<Theme>;
}

// Renders a node-name list as compact nodeset chips (KOII1_pc[1-6]) instead of
// one chip per node. A collapsed multi-node chip lists its members in a tooltip;
// a single-node chip is clickable when `onSelect` is provided.
export function NodeSetChips({ names, onSelect, variant = "outlined", sx }: NodeSetChipsProps) {
  const groups = useMemo(() => collapseNodeSet(names), [names]);
  return (
    <>
      {groups.map((group) => {
        const single = group.names.length === 1;
        const clickable = single && Boolean(onSelect);
        const chip = (
          <Chip
            key={group.label}
            size="small"
            variant={variant}
            label={group.label}
            onClick={clickable ? () => onSelect?.(group.names[0]) : undefined}
            sx={{ height: 22, fontFamily: "monospace", fontSize: "0.72rem", cursor: clickable ? "pointer" : "default", "& .MuiChip-label": { px: 0.85 }, ...sx }}
          />
        );
        return single ? chip : <Tooltip key={group.label} title={group.names.join(", ")}>{chip}</Tooltip>;
      })}
    </>
  );
}
