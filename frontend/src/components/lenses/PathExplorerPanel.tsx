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
import { alpha } from "@mui/material/styles";

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

      {result && (
        result.reachable ? (
          <Alert severity="success" icon={<RouteIcon fontSize="small" />}>{result.summary}</Alert>
        ) : (
          <Alert severity="error" icon={<BlockIcon fontSize="small" />}>
            {result.explanation[0] ?? "No path found."}
            {result.explanation.slice(1).map((line) => <Typography key={line} variant="caption" display="block">{line}</Typography>)}
          </Alert>
        )
      )}

      {result?.reachable && result.explanation.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            p: 1,
            borderRadius: 2,
            borderColor: alpha("#f59e0b", 0.35),
            bgcolor: (theme) => alpha("#f59e0b", theme.palette.mode === "dark" ? 0.12 : 0.08),
          }}
        >
          <Stack spacing={0.6}>
            {result.explanation.map((line) => (
              <Stack key={line} direction="row" spacing={0.75} alignItems="flex-start">
                <WarningAmberIcon sx={{ fontSize: 16, color: "#f59e0b", mt: "1px", flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: "text.primary", lineHeight: 1.45 }}>{line}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {result?.reachable && result.hops.length > 0 && (
        <Box sx={{ mt: 0.25 }}>
          {result.hops.map((hop, index) => {
            const isLast = index === result.hops.length - 1;
            return (
              <Box key={hop.order} sx={{ display: "flex", gap: 1.25 }}>
                <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: "50%", bgcolor: PATH_COLORS.hop, color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>{hop.order}</Box>
                  {!isLast && <Box sx={{ flex: 1, width: "2px", minHeight: 14, my: 0.25, bgcolor: "divider" }} />}
                </Stack>
                <Box sx={{ flex: 1, minWidth: 0, pb: isLast ? 0 : 1.25 }}>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minHeight: 24, flexWrap: "wrap" }}>
                    <Chip size="small" variant="outlined" label={hop.fromNode} onClick={() => onSelectRef(`node:${hop.fromNode}`)} sx={{ height: 22, cursor: "pointer", fontFamily: "monospace", "& .MuiChip-label": { px: 0.85 } }} />
                    <ArrowRightAltIcon fontSize="small" color="disabled" />
                    <Chip size="small" variant="outlined" label={hop.toNode} onClick={() => onSelectRef(`node:${hop.toNode}`)} sx={{ height: 22, cursor: "pointer", fontFamily: "monospace", "& .MuiChip-label": { px: 0.85 } }} />
                    <Chip size="small" variant="outlined" color={PROTOCOL_COLOR[hop.protocol] ?? "default"} label={hop.protocol} sx={{ height: 20 }} />
                    {hop.cost > 1 && <Chip size="small" variant="outlined" label={`cost ${hop.cost}`} sx={{ height: 20 }} />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontFamily: "monospace", wordBreak: "break-word" }}>
                    {hop.egressInterface} {hop.egressAddress} → {hop.ingressInterface} {hop.ingressAddress}
                    {hop.subnet ? ` · ${hop.subnet}` : ""}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Stack>
  );
}
