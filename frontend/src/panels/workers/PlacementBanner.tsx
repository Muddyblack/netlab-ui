import type { ReactNode } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SyncProblemIcon from "@mui/icons-material/SyncProblem";

import type { MultiserverResult } from "../../api/client";

/** Explains why per-worker placement chips are empty, so the panel never shows a
 *  bare blank. Three cases, in priority order:
 *  - transforming: a create/deploy is running right now (reuses clab-ui's
 *    `isProcessing`) → spinner, "generating".
 *  - not_created: no generated worker directories yet → prompt a Create.
 *  - stale: topology edited since the last create → prompt a re-Create.
 *  When ready (and workers exist) it renders nothing — the chips speak for
 *  themselves. */
export function PlacementBanner({
  isProcessing,
  status,
  hasWorkers
}: {
  isProcessing: boolean;
  status: MultiserverResult["placementStatus"];
  hasWorkers: boolean;
}) {
  let icon: ReactNode;
  let title: string;
  let detail: string;
  let tone: "info" | "warning" = "info";

  if (isProcessing) {
    icon = <CircularProgress size={16} />;
    title = "Generating worker configurations…";
    detail = "Splitting the topology across workers. Node placement appears here when it completes.";
  } else if (status === "not_created") {
    if (!hasWorkers) return null; // nothing to place yet — no workers defined
    icon = <InfoOutlinedIcon fontSize="small" color="info" />;
    title = "Not generated yet";
    detail =
      "Run Deploy ▸ Create to split the topology across workers. Each worker's placed nodes then show below.";
  } else if (status === "stale") {
    icon = <SyncProblemIcon fontSize="small" color="warning" />;
    title = "Placement out of date";
    detail = "The topology changed since the last create. Re-run Deploy ▸ Create to refresh worker placement.";
    tone = "warning";
  } else {
    return null; // ready — chips render on the cards
  }

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        alignItems: "flex-start",
        p: 1,
        borderRadius: 1,
        bgcolor: (t) => (tone === "warning" ? t.palette.warning.main : t.palette.info.main) + "14",
        border: "1px solid",
        borderColor: tone === "warning" ? "warning.main" : "divider"
      }}
    >
      <Box sx={{ mt: 0.25, display: "flex" }}>{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, display: "block" }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {detail}
        </Typography>
      </Box>
    </Box>
  );
}
