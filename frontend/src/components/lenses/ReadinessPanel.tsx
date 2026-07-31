import type { ReactNode } from "react";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";

import type { ReadinessCheck, ReadinessResult } from "../../api/client";
import { NodeSetChips } from "../common/NodeSetChips";

const STATUS_META: Record<string, { color: string; icon: typeof CheckCircleIcon }> = {
  pass: { color: "#22c55e", icon: CheckCircleIcon },
  warn: { color: "#f59e0b", icon: WarningAmberIcon },
  fail: { color: "#ef4444", icon: ErrorOutlineIcon },
  info: { color: "#3b82f6", icon: InfoOutlinedIcon },
};

function CheckCard({ check, onSelectRef }: { check: ReadinessCheck; onSelectRef: (ref: string) => void }) {
  const meta = STATUS_META[check.status] ?? STATUS_META.info;
  const Icon = meta.icon;
  const nodeRefs = check.objectRefs.filter((ref) => ref.startsWith("node:"));
  return (
    <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 2, borderLeft: `3px solid ${meta.color}` }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Box sx={{ width: 26, height: 26, borderRadius: 1.5, display: "grid", placeItems: "center", flexShrink: 0, bgcolor: alpha(meta.color, 0.14), color: meta.color }}>
          <Icon sx={{ fontSize: 18 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{check.title}</Typography>
          <Typography variant="caption" color="text.secondary">{check.detail}</Typography>
          {check.items.length > 0 && (
            <Stack spacing={0.4} sx={{ mt: 0.6 }}>
              {check.items.map((item, index) => (
                <Box key={index} sx={{ px: 0.85, py: 0.4, borderRadius: 1, bgcolor: "action.hover", fontFamily: "monospace", fontSize: 11.5, lineHeight: 1.4, wordBreak: "break-word" }}>
                  {item}
                </Box>
              ))}
            </Stack>
          )}
          {check.hint && <Typography variant="caption" sx={{ color: meta.color, display: "block", mt: 0.6, fontWeight: 500 }}>{check.hint}</Typography>}
          {check.items.length === 0 && nodeRefs.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.6 }} flexWrap="wrap" useFlexGap>
              <NodeSetChips names={nodeRefs.map((ref) => ref.slice(5))} onSelect={(name) => onSelectRef(`node:${name}`)} />
            </Stack>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}

function summaryPartsFor(result: ReadinessResult | null): string[] {
  if (!result) return [];
  const parts: string[] = [];
  if (result.summary.passed) parts.push(`${result.summary.passed} passed`);
  if (result.summary.warn) parts.push(`${result.summary.warn} warning${result.summary.warn === 1 ? "" : "s"}`);
  if (result.summary.fail) parts.push(`${result.summary.fail} failed`);
  return parts;
}

function ReadinessSummaryCard({ result, recheckButton }: { result: ReadinessResult; recheckButton: ReactNode }) {
  const ready = result.ready;
  const status = ready ? STATUS_META.pass : STATUS_META.fail;
  const StatusIcon = status.icon;
  const summaryParts = summaryPartsFor(result);
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: alpha(status.color, 0.4), bgcolor: alpha(status.color, 0.08) }}>
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box sx={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, bgcolor: alpha(status.color, 0.16), color: status.color }}>
          <StatusIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: status.color, lineHeight: 1.25 }}>
            {ready ? "Ready to deploy" : "Not ready"}
          </Typography>
          {summaryParts.length > 0 && (
            <Typography variant="caption" color="text.secondary">{summaryParts.join(" · ")}</Typography>
          )}
        </Box>
        {recheckButton}
      </Stack>
    </Paper>
  );
}

interface ReadinessPanelProps {
  result: ReadinessResult | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectRef: (ref: string) => void;
}

export function ReadinessPanel({ result, loading, onRefresh, onSelectRef }: ReadinessPanelProps) {
  const recheckButton = (
    <Button size="small" startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />} disabled={loading} onClick={onRefresh} sx={{ textTransform: "none", flexShrink: 0 }}>
      Re-check
    </Button>
  );

  return (
    <Stack spacing={1.25}>
      {result ? (
        <ReadinessSummaryCard result={result} recheckButton={recheckButton} />
      ) : (
        <Stack direction="row" alignItems="center">
          <Box sx={{ flex: 1 }} />
          {recheckButton}
        </Stack>
      )}

      {!result && !loading && <Alert severity="info">Run the readiness check to see if this lab can deploy.</Alert>}
      {loading && !result && <Box sx={{ display: "grid", placeItems: "center", py: 3 }}><CircularProgress size={22} /></Box>}

      <Stack spacing={0.85}>
        {result?.checks.map((check) => <CheckCard key={check.id} check={check} onSelectRef={onSelectRef} />)}
      </Stack>
    </Stack>
  );
}
