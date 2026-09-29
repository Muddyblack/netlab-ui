import { useEffect, useState } from "react";

import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import BlockIcon from "@mui/icons-material/Block";
import RouteIcon from "@mui/icons-material/Route";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Fade,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import type { PathResult, ReachabilityLens } from "../../api/client";
import type { AddressFamily } from "./LensCanvasOverlay";
import { PATH_COLORS } from "./lens-canvas-overlay/helpers";

const PROTOCOL_COLOR: Record<string, "default" | "info" | "secondary" | "success"> = {
  ospf: "info",
  isis: "secondary",
  connected: "success",
};

// Cosmetic staging for the Trace spinner: the backend memoizes the adjacency
// graph per topology, so the *first* trace builds it (slower) and later ones
// reuse the cache (near-instant). We can't observe that split from the
// client, so this just walks through plausible stages the longer computing
// stays true, giving the user something more informative than a bare spinner.
const TRACE_STAGES = ["Building adjacency graph…", "Running Dijkstra…"];

function useTraceStageLabel(computing: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!computing) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => Math.min(current + 1, TRACE_STAGES.length - 1));
    }, 650);
    return () => clearInterval(timer);
  }, [computing]);
  return TRACE_STAGES[index];
}

function PathQueryForm({
  reachability, source, target, family, vrf, computing, traceStage,
  onSourceChange, onTargetChange, onFamilyChange, onVrfChange, onCompute, onSwap,
}: {
  reachability: ReachabilityLens;
  source: string;
  target: string;
  family: AddressFamily;
  vrf: string;
  computing: boolean;
  traceStage: string;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onFamilyChange: (value: AddressFamily) => void;
  onVrfChange: (value: string) => void;
  onCompute: () => void;
  onSwap: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>Source</InputLabel>
            <Select label="Source" value={source} onChange={(event) => onSourceChange(event.target.value)}>
              {reachability.nodes.map((node) => <MenuItem key={node} value={node}>{node}</MenuItem>)}
            </Select>
          </FormControl>
          <Tooltip title="Swap source and destination">
            <IconButton size="small" onClick={onSwap}><SwapHorizIcon fontSize="small" /></IconButton>
          </Tooltip>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel>Destination</InputLabel>
            <Select label="Destination" value={target} onChange={(event) => onTargetChange(event.target.value)}>
              {reachability.nodes.map((node) => <MenuItem key={node} value={node}>{node}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {reachability.families.length > 1 && (
            <ToggleButtonGroup exclusive size="small" value={family} onChange={(_event, value) => value && onFamilyChange(value)}>
              {reachability.families.map((value) => <ToggleButton key={value} value={value} sx={{ px: 1, py: 0.35 }}>{value.toUpperCase()}</ToggleButton>)}
            </ToggleButtonGroup>
          )}
          {reachability.vrfs.length > 1 && (
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel>VRF</InputLabel>
              <Select label="VRF" value={vrf} onChange={(event) => onVrfChange(event.target.value)}>
                {reachability.vrfs.map((value) => <MenuItem key={value} value={value}>{value}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            size="small"
            color="warning"
            startIcon={computing ? <CircularProgress size={15} color="inherit" /> : <RouteIcon />}
            disabled={computing || !source || !target}
            onClick={onCompute}
            sx={{ textTransform: "none" }}
          >
            Trace
          </Button>
        </Stack>
        {computing && (
          <Fade in={computing} key={traceStage}>
            <Stack direction="row" spacing={0.6} alignItems="center" sx={{ pl: 0.25 }}>
              <CircularProgress size={10} thickness={6} sx={{ color: "text.secondary" }} />
              <Typography variant="caption" color="text.secondary">
                {traceStage}
              </Typography>
            </Stack>
          </Fade>
        )}
      </Stack>
    </Paper>
  );
}

function roleAt(index: number, length: number): "source" | "destination" | undefined {
  if (index === 0) return "source";
  return index === length - 1 ? "destination" : undefined;
}

function NodeChip({ name, role, onSelectRef }: { name: string; role?: "source" | "destination"; onSelectRef: (ref: string) => void }) {
  return (
    <Chip
      size="small"
      variant={role ? "filled" : "outlined"}
      color={role ? "warning" : "default"}
      label={name}
      onClick={() => onSelectRef(`node:${name}`)}
      sx={{ height: 24, fontFamily: "monospace", fontWeight: role ? 700 : 500 }}
    />
  );
}

/** The verdict in one card: reachable or not, the route as a chain of nodes,
 * and any caveats as slim notes — instead of a green box, an amber box and a
 * list that all said parts of the same thing. */
function PathSummary({ result, source, target, onSelectRef }: { result: PathResult; source: string; target: string; onSelectRef: (ref: string) => void }) {
  if (!result.reachable) {
    return (
      <Alert severity="error" icon={<BlockIcon fontSize="small" />}>
        {result.explanation[0] ?? "No path found."}
        {result.explanation.slice(1).map((line) => <Typography key={line} variant="caption" display="block">{line}</Typography>)}
      </Alert>
    );
  }
  const chain = result.hops.length ? [result.hops[0].fromNode, ...result.hops.map((hop) => hop.toNode)] : [source, target];
  const protocols = [...new Set(result.hops.map((hop) => hop.protocol))];
  const cost = result.hops.reduce((sum, hop) => sum + (hop.cost || 0), 0);
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
          <RouteIcon fontSize="small" color="success" />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Reachable · {result.hops.length} hop{result.hops.length === 1 ? "" : "s"}
          </Typography>
          {protocols.map((protocol) => (
            <Chip key={protocol} size="small" variant="outlined" color={PROTOCOL_COLOR[protocol] ?? "default"} label={protocol} sx={{ height: 20 }} />
          ))}
          {cost > result.hops.length && <Chip size="small" variant="outlined" label={`cost ${cost}`} sx={{ height: 20 }} />}
        </Stack>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap spacing={0.25} sx={{ rowGap: 0.5 }}>
          {chain.map((name, index) => (
            <Stack key={`${name}:${index}`} direction="row" alignItems="center" spacing={0.25}>
              <NodeChip name={name} role={roleAt(index, chain.length)} onSelectRef={onSelectRef} />
              {index < chain.length - 1 && <ArrowRightAltIcon fontSize="small" color="disabled" />}
            </Stack>
          ))}
        </Stack>
        {result.explanation.map((line) => (
          <Stack key={line} direction="row" spacing={0.75} alignItems="flex-start">
            <WarningAmberIcon sx={{ fontSize: 15, color: "warning.main", mt: "2px", flexShrink: 0 }} />
            <Typography variant="caption" sx={{ lineHeight: 1.45, color: "text.secondary" }}>{line}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function EndpointLine({ node, iface, address }: { node: string; iface?: string | null; address?: string | null }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "34px 64px 1fr", columnGap: 0.75, fontFamily: "monospace", fontSize: 12 }}>
      <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>{node}</Box>
      <Box component="span" sx={{ color: "text.secondary" }}>{iface ?? ""}</Box>
      <Box component="span" sx={{ color: "text.secondary" }}>{address ?? ""}</Box>
    </Box>
  );
}

function PathHopRow({ hop, isLast, onSelectRef }: { hop: PathResult["hops"][number]; isLast: boolean; onSelectRef: (ref: string) => void }) {
  return (
    <Box sx={{ display: "flex", gap: 1.25 }}>
      <Stack alignItems="center" sx={{ flexShrink: 0 }}>
        <Box sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: PATH_COLORS.hop, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{hop.order}</Box>
        {!isLast && <Box sx={{ flex: 1, width: "2px", minHeight: 10, my: 0.25, bgcolor: "divider" }} />}
      </Stack>
      <Box sx={{ flex: 1, minWidth: 0, pb: isLast ? 0 : 1.25 }}>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minHeight: 22, mb: 0.4 }}>
          <Typography variant="caption" sx={{ fontFamily: "monospace", cursor: "pointer" }} onClick={() => onSelectRef(`node:${hop.fromNode}`)}>{hop.fromNode}</Typography>
          <ArrowRightAltIcon sx={{ fontSize: 16 }} color="disabled" />
          <Typography variant="caption" sx={{ fontFamily: "monospace", cursor: "pointer" }} onClick={() => onSelectRef(`node:${hop.toNode}`)}>{hop.toNode}</Typography>
          {hop.subnet && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>· {hop.subnet}</Typography>}
          <Box sx={{ flex: 1 }} />
          <Chip size="small" variant="outlined" color={PROTOCOL_COLOR[hop.protocol] ?? "default"} label={hop.cost > 1 ? `${hop.protocol} · cost ${hop.cost}` : hop.protocol} sx={{ height: 18, fontSize: 11 }} />
        </Stack>
        <EndpointLine node={hop.fromNode} iface={hop.egressInterface} address={hop.egressAddress} />
        <EndpointLine node={hop.toNode} iface={hop.ingressInterface} address={hop.ingressAddress} />
      </Box>
    </Box>
  );
}

function PathHopsList({ hops, onSelectRef }: { hops: PathResult["hops"]; onSelectRef: (ref: string) => void }) {
  return (
    <Box sx={{ px: 0.5 }}>
      {hops.map((hop, index) => (
        <PathHopRow key={hop.order} hop={hop} isLast={index === hops.length - 1} onSelectRef={onSelectRef} />
      ))}
    </Box>
  );
}

interface PathExplorerPanelProps {
  reachability: ReachabilityLens;
  source: string;
  target: string;
  family: AddressFamily;
  vrf: string;
  result: PathResult | null;
  computing: boolean;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
  onFamilyChange: (value: AddressFamily) => void;
  onVrfChange: (value: string) => void;
  onCompute: () => void;
  onSwap: () => void;
  onSelectRef: (ref: string) => void;
}

export function PathExplorerPanel({
  reachability,
  source,
  target,
  family,
  vrf,
  result,
  computing,
  onSourceChange,
  onTargetChange,
  onFamilyChange,
  onVrfChange,
  onCompute,
  onSwap,
  onSelectRef,
}: PathExplorerPanelProps) {
  const traceStage = useTraceStageLabel(computing);

  if (!reachability.available) {
    return (
      <Alert severity="info" icon={<RouteIcon fontSize="small" />}>
        Add at least two addressed nodes to trace intended reachability.
      </Alert>
    );
  }

  return (
    <Stack spacing={1.25}>
      <PathQueryForm
        reachability={reachability}
        source={source}
        target={target}
        family={family}
        vrf={vrf}
        computing={computing}
        traceStage={traceStage}
        onSourceChange={onSourceChange}
        onTargetChange={onTargetChange}
        onFamilyChange={onFamilyChange}
        onVrfChange={onVrfChange}
        onCompute={onCompute}
        onSwap={onSwap}
      />

      {result && <PathSummary result={result} source={source} target={target} onSelectRef={onSelectRef} />}

      {result?.reachable && result.hops.length > 0 && <PathHopsList hops={result.hops} onSelectRef={onSelectRef} />}
    </Stack>
  );
}
