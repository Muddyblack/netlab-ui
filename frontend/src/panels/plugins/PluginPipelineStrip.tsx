import { Box, Chip, Tooltip, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

import type { PluginPipelineEntry, PluginPipelineInfo } from "./types";

// The schema defaults these to empty lists; normalise once so the render path
// isn't threaded with `?? []`.
const hooksOf = (entry: PluginPipelineEntry) => entry.hooks ?? [];
const missingOf = (entry: PluginPipelineEntry) => entry.missing_requires ?? [];

/**
 * The topology's plugins in the order netlab will actually run them.
 *
 * netlab sorts `plugin:` by each plugin's `_requires`/`_execute_after`
 * metadata before executing it, so the order written in the file is not
 * necessarily the execution order — and an unsatisfied `_requires` aborts the
 * transformation. Neither is visible from the CLI until you run `netlab up`,
 * which is exactly why it belongs here.
 */
export function PluginPipelineStrip({ pipeline }: { pipeline: PluginPipelineInfo }) {
  if (pipeline.order.length === 0) return null;

  const problems = pipeline.order.filter(
    (entry) => !entry.known || missingOf(entry).length > 0
  );

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: problems.length > 0 ? "error.main" : "divider",
        borderRadius: 1,
        p: 1,
        display: "grid",
        gap: 0.75,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
        Execution order
        {pipeline.reordered && (
          <Typography component="span" variant="caption" sx={{ fontWeight: 400, color: "text.secondary" }}>
            {" "}
            — reordered by plugin dependencies
          </Typography>
        )}
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.4 }}>
        {pipeline.order.map((entry, index) => {
          const broken = !entry.known || missingOf(entry).length > 0;
          let tooltip = "No transformation hooks defined";
          if (hooksOf(entry).length > 0) tooltip = `Runs at: ${hooksOf(entry).join(", ")}`;
          if (missingOf(entry).length > 0) {
            const verb = missingOf(entry).length === 1 ? "is" : "are";
            tooltip = `Requires ${missingOf(entry).join(", ")}, which ${verb} not in this topology's plugin list`;
          }
          if (!entry.known) tooltip = `${entry.id} was not found on netlab's plugin search path`;

          return (
            <Box key={entry.id} sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
              {index > 0 && (
                <ArrowForwardIcon sx={{ fontSize: 13, color: "text.disabled" }} />
              )}
              <Tooltip title={tooltip}>
                <Chip
                  label={entry.id}
                  size="small"
                  color={broken ? "error" : "default"}
                  variant={broken ? "filled" : "outlined"}
                  sx={{ height: 20, fontSize: "0.68rem", "& .MuiChip-label": { px: 0.75 } }}
                />
              </Tooltip>
            </Box>
          );
        })}
      </Box>

      {problems.length > 0 && (
        <Typography variant="caption" sx={{ color: "error.main" }}>
          {problems.length === 1 ? "This will" : "These will"} abort the netlab transformation:{" "}
          {problems
            .map((entry) =>
              entry.known
                ? `${entry.id} requires ${missingOf(entry).join(", ")}`
                : `${entry.id} not found`
            )
            .join("; ")}
        </Typography>
      )}
    </Box>
  );
}
