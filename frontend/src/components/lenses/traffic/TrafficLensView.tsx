import { useMemo } from "react";
import { Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import { useEdges } from "@containerlab/clab-ui";

import { useRuntimeContainers } from "../../../host/runtimeStore";
import { TRAFFIC_COLORS, formatBps, linkTraffic, loadLevel, type LinkTraffic } from "./linkTraffic";

function Swatch({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 18, height: 0, borderTop: `3px ${dashed ? "dashed" : "solid"} ${color}` }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}

function statusText(link: LinkTraffic): { text: string; color?: string } {
  if (link.down) return { text: "down", color: TRAFFIC_COLORS.down };
  if (link.newErrors > 0) return { text: `+${link.newErrors} err/drop`, color: TRAFFIC_COLORS.errors };
  if (link.totalErrors > 0) return { text: `${link.totalErrors} err/drop (old)` };
  return { text: "ok" };
}

/** Lens panel for live traffic: legend plus every link, busiest first. */
export function TrafficLensView() {
  const edges = useEdges();
  const containers = useRuntimeContainers();
  const links = useMemo(
    () => linkTraffic(edges, containers).sort((a, b) => Number(b.down) - Number(a.down) || b.newErrors - a.newErrors || (b.bps ?? 0) - (a.bps ?? 0)),
    [edges, containers],
  );

  if (links.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
        No live interface counters. Deploy the lab — the Traffic lens reads container interfaces every 3 seconds.
      </Typography>
    );
  }

  return (
    <Box sx={{ p: 1 }}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Swatch color={TRAFFIC_COLORS.load[0]} label="< 100 kb/s" />
        <Swatch color={TRAFFIC_COLORS.load[1]} label="< 1 Mb/s" />
        <Swatch color={TRAFFIC_COLORS.load[2]} label="< 10 Mb/s" />
        <Swatch color={TRAFFIC_COLORS.load[3]} label="≥ 10 Mb/s" />
        <Swatch color={TRAFFIC_COLORS.errors} label="new errors/drops" />
        <Swatch color={TRAFFIC_COLORS.down} label="down" dashed />
      </Stack>
      <Table size="small" sx={{ "& td, & th": { px: 0.75, py: 0.4, fontSize: "0.75rem" } }}>
        <TableHead>
          <TableRow>
            <TableCell>Link</TableCell>
            <TableCell align="right">Rate</TableCell>
            <TableCell align="right">pps</TableCell>
            <TableCell>Health</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {links.map((link) => {
            const status = statusText(link);
            return (
              <TableRow key={link.edgeId}>
                <TableCell sx={{ fontFamily: "monospace" }}>
                  {link.source.node}:{link.source.iface} ↔ {link.target.node}:{link.target.iface}
                </TableCell>
                <TableCell align="right" sx={{ color: link.bps ? TRAFFIC_COLORS.load[loadLevel(link.bps)] : "text.secondary", fontWeight: 600 }}>
                  {formatBps(link.bps)}
                </TableCell>
                <TableCell align="right">{link.pps ?? "…"}</TableCell>
                <TableCell sx={{ color: status.color }}>
                  <Tooltip title="Errors and drops, both ends; “new” means since the previous sample">
                    <span>{status.text}</span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}
