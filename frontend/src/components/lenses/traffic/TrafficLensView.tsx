import { useMemo, useState } from "react";
import { Box, Chip, Tooltip, Typography } from "@mui/material";
import { useEdges } from "@containerlab/clab-ui";

import { useRateHistory, useRuntimeContainers } from "../../../host/runtimeStore";
import { LinkFaultMenu } from "./LinkFaultMenu";
import { LinkRateChart, LinkSparkline, StatTile } from "./TrafficCharts";
import { TRAFFIC_COLORS, formatBps, linkTraffic, type LinkTraffic } from "./linkTraffic";

function HealthChip({ link }: { link: LinkTraffic }) {
  if (link.down) return <Chip size="small" label="down" sx={{ height: 20, bgcolor: TRAFFIC_COLORS.down, color: "#fff" }} />;
  if (link.newErrors > 0) return <Chip size="small" label={`+${link.newErrors} drops`} sx={{ height: 20, bgcolor: TRAFFIC_COLORS.errors, color: "#fff" }} />;
  if (link.totalErrors > 0) {
    return (
      <Tooltip title="Errors/drops counted earlier, none in the last sample">
        <Chip size="small" variant="outlined" label={`${link.totalErrors} old`} sx={{ height: 20 }} />
      </Tooltip>
    );
  }
  return <Chip size="small" variant="outlined" color="success" label="ok" sx={{ height: 20 }} />;
}

function linkName(link: LinkTraffic): string {
  return `${link.source.node}:${link.source.iface} ↔ ${link.target.node}:${link.target.iface}`;
}

/** Lens panel for live traffic, Kubus-style: headline tiles, the selected
 * link's two directions over time, then every link with its trend.
 * Selecting a link on the canvas (or a row) drives the chart. */
export function TrafficLensView({ sessionId, onToast }: {
  sessionId: string;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}) {
  const edges = useEdges();
  const containers = useRuntimeContainers();
  const history = useRateHistory();
  const [picked, setPicked] = useState<string | null>(null);
  const links = useMemo(
    () => linkTraffic(edges, containers).sort((a, b) => Number(b.down) - Number(a.down) || b.newErrors - a.newErrors || (b.bps ?? 0) - (a.bps ?? 0)),
    [edges, containers],
  );

  if (links.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
        No live interface counters yet. Deploy the lab — traffic is read from the containers every 3 seconds.
      </Typography>
    );
  }

  const canvasSelected = edges.find((edge) => edge.selected)?.id;
  const busiest = [...links].sort((a, b) => (b.bps ?? 0) - (a.bps ?? 0))[0];
  const selected = links.find((link) => link.edgeId === canvasSelected)
    ?? links.find((link) => link.edgeId === picked)
    ?? busiest;
  const total = links.reduce((sum, link) => sum + (link.bps ?? 0), 0);
  const down = links.filter((link) => link.down).length;
  const erroring = links.filter((link) => link.newErrors > 0).length;

  return (
    <Box sx={{ p: 1, display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
        <StatTile label="Total traffic" value={formatBps(total)} detail={`${links.length} links`} />
        <StatTile label="Busiest link" value={formatBps(busiest.bps)} detail={`${busiest.source.node} ↔ ${busiest.target.node}`} />
        <StatTile label="Links down" value={String(down)} tone={down ? "critical" : undefined} />
        <StatTile label="Dropping / erroring now" value={String(erroring)} tone={erroring ? "critical" : undefined} />
      </Box>

      <LinkRateChart link={selected} history={history} />

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden", bgcolor: "background.paper" }}>
        {links.map((link) => {
          const active = link.edgeId === selected.edgeId;
          return (
            <Box
              key={link.edgeId}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => setPicked(link.edgeId)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setPicked(link.edgeId); }}
              sx={{
                display: "grid", gridTemplateColumns: "minmax(0,1fr) 84px 72px auto 24px", alignItems: "center", gap: 1,
                px: 1, py: 0.5, cursor: "pointer", borderLeft: 3,
                borderLeftColor: active ? "primary.main" : "transparent",
                bgcolor: active ? "action.selected" : "transparent",
                "&:hover": { bgcolor: "action.hover" },
                "& + &": { borderTop: 1, borderTopColor: "divider" },
              }}
            >
              <Typography variant="caption" noWrap sx={{ fontFamily: "monospace" }} title={linkName(link)}>{linkName(link)}</Typography>
              <LinkSparkline link={link} history={history} />
              <Typography variant="caption" align="right" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: link.bps ? "text.primary" : "text.secondary" }}>
                {formatBps(link.bps)}
              </Typography>
              <HealthChip link={link} />
              <Box onClick={(event) => event.stopPropagation()}>
                <LinkFaultMenu sessionId={sessionId} link={link} onResult={onToast} />
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Click a link on the canvas or a row to chart it · ⚡ injects a fault · counters every 3 s
      </Typography>
    </Box>
  );
}
