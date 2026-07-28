import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import EditIcon from "@mui/icons-material/Edit";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";

import { UnitPreview } from "../../components/UnitPreview";
import { UNIT_DRAG_MIME } from "./useCanvasDropTarget";
import type { UnitInfo } from "./types";

interface UnitCardProps {
  unit: UnitInfo;
  unitsByName: Record<string, UnitInfo>;
  isLocked: boolean;
  outdatedCount: number;
  pinned: boolean;
  onOpen: (unit: UnitInfo) => void;
  onTogglePin: (unit: UnitInfo) => void;
  onPlace: (name: string) => void;
  onExport: (name: string) => void;
  onDelete: (name: string) => void;
}

export function UnitCard({
  unit,
  unitsByName,
  isLocked,
  outdatedCount,
  pinned,
  onOpen,
  onTogglePin,
  onPlace,
  onExport,
  onDelete,
}: UnitCardProps) {
  const nodeCount = unit.nodes?.length || 0;
  const includes = unit.includes || [];
  const labelParts: string[] = [];
  if (nodeCount > 0) labelParts.push(`${nodeCount} ${nodeCount === 1 ? "node" : "nodes"}`);
  for (const inc of includes) labelParts.push(`${inc.count ?? 1} × ${inc.template}`);
  const labelText = labelParts.join(" + ") || "Empty unit";

  return (
    <Tooltip title={isLocked ? "Unlock the lab to place units" : `${labelText} — drag onto the canvas to place a copy`} arrow enterDelay={400}>
      <Paper
        variant="outlined"
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
          width: 148,
          flexShrink: 0,
          p: 0.75,
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
          cursor: isLocked ? "not-allowed" : "grab",
          opacity: isLocked ? 0.6 : 1,
          position: "relative",
          "&:active": { cursor: "grabbing" },
          "&:hover": { borderColor: "primary.main", "& .unit-card-actions": { opacity: 1 } }
        }}
      >
        <Box sx={{ display: "flex", justifyContent: "center", bgcolor: "action.hover", borderRadius: 1 }}>
          <UnitPreview unit={unit} unitsByName={unitsByName} width={132} height={56} />
        </Box>
        <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: "0.8rem", textAlign: "center" }}>
          {unit.name}
        </Typography>
        {(outdatedCount || (unit.version ?? 1) > 1) && (
          <Stack direction="row" spacing={0.5} justifyContent="center" sx={{ mt: -0.25 }}>
            {(unit.version ?? 1) > 1 && (
              <Chip size="small" variant="outlined" label={`v${unit.version}`} sx={{ height: 16, "& .MuiChip-label": { px: 0.6, fontSize: "0.62rem" } }} />
            )}
            {outdatedCount ? (
              <Tooltip title={`${outdatedCount} placed instance(s) are on an older version — re-place to update`} arrow>
                <Chip size="small" color="warning" label={`${outdatedCount} outdated`} sx={{ height: 16, "& .MuiChip-label": { px: 0.6, fontSize: "0.62rem" } }} />
              </Tooltip>
            ) : null}
          </Stack>
        )}

        <Box
          className="unit-card-actions"
          sx={{
            position: "absolute",
            top: 4,
            right: 4,
            display: "flex",
            gap: 0,
            opacity: pinned ? 1 : 0,
            transition: "opacity 120ms",
            bgcolor: "background.paper",
            borderRadius: 1,
            boxShadow: 1
          }}
        >
          <Tooltip title="Open unit on the canvas to edit it" arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(unit);
              }}
              aria-label={`Edit ${unit.name}`}
              sx={{ p: 0.4 }}
            >
              <EditIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={pinned ? "Unpin unit" : "Pin unit"} arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(unit);
              }}
              aria-label={`${pinned ? "Unpin" : "Pin"} ${unit.name}`}
              sx={{ p: 0.4 }}
            >
              {pinned ? <PushPinIcon sx={{ fontSize: 15 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 15 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Place with options (count, device, image)" arrow>
            <span>
              <IconButton
                size="small"
                disabled={isLocked}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlace(unit.name);
                }}
                aria-label={`Place ${unit.name} with options`}
                sx={{ p: 0.4 }}
              >
                <TuneIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Export unit" arrow>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onExport(unit.name);
              }}
              aria-label={`Export ${unit.name}`}
              sx={{ p: 0.4 }}
            >
              <FileDownloadOutlinedIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete unit" arrow>
            <IconButton
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(unit.name);
              }}
              aria-label={`Delete ${unit.name}`}
              sx={{ p: 0.4 }}
            >
              <DeleteIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Paper>
    </Tooltip>
  );
}
