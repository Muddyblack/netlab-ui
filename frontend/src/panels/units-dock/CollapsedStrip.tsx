import { Box, IconButton, Paper, Tooltip, Typography } from "@mui/material";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import WidgetsIcon from "@mui/icons-material/Widgets";
import { UnitPreview } from "../../components/UnitPreview";
import { UNIT_DRAG_MIME } from "./useCanvasDropTarget";
import type { UnitInfo } from "./types";

interface CollapsedStripProps {
  units: UnitInfo[];
  unitsByName: Record<string, UnitInfo>;
  isLocked: boolean;
  onExpand: () => void;
}

/** Slim strip shown when the dock is collapsed: every unit still appears as a
 * tiny draggable preview, so collapsing never hides the library. */
export function CollapsedStrip({ units, unitsByName, isLocked, onExpand }: CollapsedStripProps) {
  return (
    <Paper
      elevation={3}
      sx={{
        pointerEvents: "auto",
        mb: 1,
        pl: 1.25,
        pr: 0.5,
        py: 0.25,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        borderRadius: 4,
        maxWidth: "70%",
        overflow: "hidden"
      }}
    >
      <WidgetsIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
      <Box sx={{ display: "flex", gap: 0.5, overflowX: "auto", alignItems: "center" }}>
        {units.map((unit) => (
          <Tooltip key={unit.name} title={isLocked ? "Unlock the lab to place units" : `${unit.name} — drag onto the canvas`} arrow>
            <Box
              draggable={!isLocked}
              onDragStart={(e) => {
                if (isLocked) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData(UNIT_DRAG_MIME, unit.name);
                e.dataTransfer.effectAllowed = "copyMove";
              }}
              sx={{
                display: "flex",
                borderRadius: 0.75,
                cursor: isLocked ? "not-allowed" : "grab",
                opacity: isLocked ? 0.5 : 1,
                flexShrink: 0,
                bgcolor: "action.hover",
                "&:active": { cursor: "grabbing" },
                "&:hover": { outline: 1, outlineColor: "primary.main" }
              }}
            >
              <UnitPreview unit={unit} unitsByName={unitsByName} width={40} height={22} />
            </Box>
          </Tooltip>
        ))}
        {units.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            Units
          </Typography>
        )}
      </Box>
      <Tooltip title="Expand units dock" arrow>
        <IconButton size="small" onClick={onExpand} aria-label="Expand units dock" sx={{ p: 0.25, flexShrink: 0 }}>
          <ExpandLessIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Paper>
  );
}
