import type { ReactElement } from "react";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import SyncIcon from "@mui/icons-material/Sync";
import { Box, Chip, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import type { DeploymentOverview } from "../api/client";

export type DeploymentProgress = DeploymentOverview;

function stateVisual(state: string): { color: "error" | "success" | "default"; icon: ReactElement } {
  if (state === "failed") return { color: "error", icon: <ErrorIcon /> };
  if (state === "ready" || state === "stopped") return { color: "success", icon: <CheckCircleIcon /> };
  if (state === "queued") return { color: "default", icon: <HourglassEmptyIcon /> };
  return { color: "default", icon: <SyncIcon /> };
}

export function CanvasDeploymentProgress({ progress }: { progress: DeploymentProgress | null }) {
  if (!progress) return null;
  const entries = Object.entries(progress.nodes);
  const finished = entries.filter(([, state]) => ["ready", "stopped", "failed"].includes(state)).length;
  return (
    <Paper elevation={6} sx={{ position: "absolute", zIndex: 12, top: 12, right: 12, width: 280, maxHeight: "50%", overflow: "auto", p: 1.25, border: 1, borderColor: "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>netlab {progress.action}</Typography>
        <Typography variant="caption" color="text.secondary">{finished}/{entries.length}</Typography>
      </Stack>
      {!progress.done && <LinearProgress variant={entries.length ? "determinate" : "indeterminate"} value={entries.length ? finished / entries.length * 100 : undefined} sx={{ my: 1 }} />}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mt: progress.done ? 1 : 0 }}>
        {entries.map(([node, state]) => {
          const visual = stateVisual(state);
          return <Chip key={node} size="small" variant="outlined" color={visual.color} icon={visual.icon} label={`${node} · ${state}`} />;
        })}
      </Box>
    </Paper>
  );
}
