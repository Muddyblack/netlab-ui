import { useMemo } from "react";
import { Box, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { SparkLineChart } from "@mui/x-charts/SparkLineChart";

import { interfaceKey, type RateSample } from "../../../host/runtimeStore";
import { TRAFFIC_COLORS, formatBps, type LinkTraffic } from "./linkTraffic";

/** The measured end's samples, turned into source→target / target→source. */
export function linkSeries(link: LinkTraffic, history: Map<string, RateSample[]>) {
  if (!link.measured) return [];
  const end = link.measured === "source" ? link.source : link.target;
  const samples = history.get(interfaceKey(end.node, end.iface)) ?? [];
  // The source end transmits source→target; the target end receives it.
  return samples.map((sample) => (link.measured === "source"
    ? { t: sample.t, forward: sample.tx, reverse: sample.rx }
    : { t: sample.t, forward: sample.rx, reverse: sample.tx }));
}

function useDirectionColors() {
  const dark = useTheme().palette.mode === "dark";
  return {
    forward: dark ? TRAFFIC_COLORS.forward.dark : TRAFFIC_COLORS.forward.light,
    reverse: dark ? TRAFFIC_COLORS.reverse.dark : TRAFFIC_COLORS.reverse.light,
  };
}

function shortBps(value: number | null): string {
  return value === null ? "" : formatBps(Math.abs(value)).replace(" ", "");
}

const clock = (value: Date) => value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Headline number with its label — the Kubus tile. */
export function StatTile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "critical" }) {
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, px: 1.25, py: 1, minWidth: 0, bgcolor: "background.paper" }}>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{label}</Typography>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        {tone === "critical" && <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: TRAFFIC_COLORS.errors, flexShrink: 0 }} />}
        <Typography variant="h6" noWrap sx={{ fontWeight: 600, lineHeight: 1.3, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      </Stack>
      {detail && <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block", fontFamily: "monospace" }}>{detail}</Typography>}
    </Box>
  );
}

/** Both directions of one link over the last minutes, area + crosshair tooltip. */
export function LinkRateChart({ link, history }: { link: LinkTraffic; history: Map<string, RateSample[]> }) {
  const colors = useDirectionColors();
  const points = useMemo(() => linkSeries(link, history), [link, history]);
  const forwardLabel = `${link.source.node} → ${link.target.node}`;
  const reverseLabel = `${link.target.node} → ${link.source.node}`;
  const last = points[points.length - 1];

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25, bgcolor: "background.paper" }}>
      <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
        <Box component="span" sx={{ fontFamily: "monospace" }}>{link.source.node}:{link.source.iface} ↔ {link.target.node}:{link.target.iface}</Box>
        <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}> — {formatBps(link.bps)}</Box>
      </Typography>
      {/* Legend doubles as the direct label: series colour, direction, current value. */}
      <Stack direction="row" columnGap={2} rowGap={0.25} flexWrap="wrap" sx={{ mt: 0.5 }}>
        {[{ label: forwardLabel, color: colors.forward, value: last?.forward }, { label: reverseLabel, color: colors.reverse, value: last?.reverse }].map((item) => (
          <Stack key={item.label} direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 8, borderRadius: 1, bgcolor: item.color, opacity: 0.85 }} />
            <Typography variant="caption" color="text.secondary">{item.label}</Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatBps(item.value ?? null)}</Typography>
          </Stack>
        ))}
      </Stack>
      {points.length < 2 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 5, textAlign: "center" }}>Collecting samples…</Typography>
      ) : (
        // Mirrored in/out chart: one direction above the zero line, the other
        // below, so the two areas never overlap however similar they are.
        <LineChart
          height={180}
          hideLegend
          grid={{ horizontal: true }}
          margin={{ left: 4, right: 12, top: 10, bottom: 4 }}
          xAxis={[{
            data: points.map((point) => new Date(point.t)),
            scaleType: "time",
            tickNumber: 3,
            valueFormatter: clock,
          }]}
          yAxis={[{ valueFormatter: shortBps, width: 60, tickNumber: 4 }]}
          series={[
            { data: points.map((point) => point.forward), label: forwardLabel, color: colors.forward, area: true, baseline: 0, showMark: false, curve: "monotoneX", valueFormatter: (v) => formatBps(Math.abs(v ?? 0)) },
            { data: points.map((point) => -point.reverse), label: reverseLabel, color: colors.reverse, area: true, baseline: 0, showMark: false, curve: "monotoneX", valueFormatter: (v) => formatBps(Math.abs(v ?? 0)) },
          ]}
          sx={{
            "& .MuiAreaElement-root": { fillOpacity: 0.22 },
            "& .MuiLineElement-root": { strokeWidth: 2 },
            "& .MuiChartsGrid-line": { strokeDasharray: "2 4", opacity: 0.45 },
          }}
        >
          <ChartsReferenceLine y={0} lineStyle={{ strokeOpacity: 0.35 }} />
        </LineChart>
      )}
    </Box>
  );
}

/** Tiny trend of a link's total rate for its list row. */
export function LinkSparkline({ link, history }: { link: LinkTraffic; history: Map<string, RateSample[]> }) {
  const colors = useDirectionColors();
  const data = useMemo(() => linkSeries(link, history).map((point) => point.forward + point.reverse), [link, history]);
  return (
    <Box sx={{ width: 84, height: 26, overflow: "hidden" }}>
      {data.length >= 2 && (
        <SparkLineChart data={data} area curve="monotoneX" height={26} width={84} color={colors.forward}
          sx={{ "& .MuiAreaElement-root": { fillOpacity: 0.2 } }} />
      )}
    </Box>
  );
}
