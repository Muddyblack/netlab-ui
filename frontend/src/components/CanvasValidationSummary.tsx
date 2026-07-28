import { useRef, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Box, Chip, Collapse, IconButton, Paper, Stack, Typography } from "@mui/material";

import type { ValidationIssue } from "../hooks/useLabLifecycle";
import { usePanelInsets } from "../panels/units-dock/usePanelInsets";

export function CanvasValidationSummary({ issues, onClose }: { issues: ValidationIssue[]; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const insets = usePanelInsets(rootRef);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;

  if (issues.length === 0) return null;
  return (
    <Box
      ref={rootRef}
      sx={{
        position: "absolute",
        zIndex: 12,
        top: 12,
        left: insets.left,
        right: insets.right,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none"
      }}
    >
      <Paper
        elevation={6}
        sx={{
          pointerEvents: "auto",
          width: "min(560px, calc(100% - 32px))",
          border: 1,
          borderColor: errors ? "error.main" : "warning.main",
          overflow: "hidden"
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.8 }}>
          {errors ? <ErrorOutlineIcon color="error" /> : <WarningAmberIcon color="warning" />}
          <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>netlab validation found {issues.length} {issues.length === 1 ? "issue" : "issues"}</Typography>
          {errors > 0 && <Chip size="small" color="error" label={`${errors} error${errors === 1 ? "" : "s"}`} />}
          {warnings > 0 && <Chip size="small" color="warning" label={`${warnings} warning${warnings === 1 ? "" : "s"}`} />}
          <Typography component="button" variant="caption" onClick={() => setExpanded((value) => !value)} sx={{ border: 0, bgcolor: "transparent", color: "primary.main", cursor: "pointer" }}>{expanded ? "Hide" : "Details"}</Typography>
          <IconButton size="small" onClick={onClose} aria-label="Dismiss validation results"><CloseIcon fontSize="small" /></IconButton>
        </Stack>
        <Collapse in={expanded}>
          <Box sx={{ borderTop: 1, borderColor: "divider", maxHeight: 240, overflow: "auto", p: 1 }}>
            {issues.map((issue, index) => (
              <Stack key={`${issue.entityType}:${issue.entityId}:${index}`} direction="row" spacing={1} sx={{ py: 0.55 }}>
                <Chip size="small" variant="outlined" color={issue.severity === "error" ? "error" : "warning"} label={issue.entityId || issue.entityType} sx={{ minWidth: 72 }} />
                <Typography variant="caption" sx={{ pt: 0.35, overflowWrap: "anywhere" }}>{issue.message}</Typography>
              </Stack>
            ))}
          </Box>
        </Collapse>
      </Paper>
    </Box>
  );
}
