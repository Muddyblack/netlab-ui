import { useState } from "react";
import { Box, Chip, CircularProgress, Collapse, IconButton, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ReplayIcon from "@mui/icons-material/Replay";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";

import type { ExecResult } from "../../api/client";
import { NodeSetChips } from "../../components/common/NodeSetChips";
import { groupIdenticalResults, resultFailed, resultText, statusLabel, type ExecRun, type OutputGroup } from "./model";
import { highlightOutput } from "./highlight";

function StatusChip({ result }: { result: ExecResult }) {
  if (result.timedOut) return <Chip size="small" color="warning" label="timeout" sx={{ height: 18 }} />;
  const failed = resultFailed(result);
  return (
    <Chip
      size="small"
      color={failed ? "error" : "success"}
      variant={failed ? "filled" : "outlined"}
      label={statusLabel(result)}
      sx={{ height: 18, fontSize: "0.68rem" }}
    />
  );
}

interface OutputCardProps {
  nodes: string[];
  result?: ExecResult;
  pending?: boolean;
  open: boolean;
  onToggle: () => void;
  highlight: boolean;
}

function outputBody(pending: boolean, text: string, highlight: boolean) {
  if (pending) return "…";
  if (!text) return <Typography component="span" variant="caption" color="text.secondary">(no output)</Typography>;
  return highlight ? highlightOutput(text) : text;
}

/** One node's (or one group of identical nodes') output: a full-width,
 * collapsible section, stacked under the others like terminals. */
function OutputCard({ nodes, result, pending, open, onToggle, highlight }: OutputCardProps) {
  const text = result ? resultText(result) : "";
  return (
    <Box
      sx={{
        border: 1,
        borderColor: result && resultFailed(result) ? "error.main" : "divider",
        borderRadius: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        bgcolor: "background.paper",
      }}
    >
      <Box
        role="button"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} output of ${nodes.join(", ")}`}
        onClick={onToggle}
        sx={{
          display: "flex", alignItems: "center", gap: 0.5, px: 0.5, py: 0.5, flexWrap: "wrap", cursor: "pointer",
          borderBottom: open ? 1 : 0, borderColor: "divider", "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform .15s", transform: open ? "none" : "rotate(-90deg)" }} />
        <NodeSetChips names={nodes} variant="filled" />
        <Box sx={{ flex: 1 }} />
        {pending && <CircularProgress size={12} />}
        {result && <StatusChip result={result} />}
        {result?.durationMs !== undefined && (
          <Typography variant="caption" color="text.secondary">{(result.durationMs / 1000).toFixed(1)}s</Typography>
        )}
        {result && (
          <Tooltip title="Copy output">
            <IconButton size="small" aria-label={`Copy output of ${nodes.join(", ")}`} onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(text); }} sx={{ width: 20, height: 20 }}>
              <ContentCopyIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box
          component="pre"
          sx={{ m: 0, p: 1, fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "pre", overflow: "auto", maxHeight: 360 }}
        >
          {outputBody(Boolean(pending), text, highlight)}
        </Box>
      </Collapse>
    </Box>
  );
}

export function RunResults({ run, grouped, highlight, onRerun }: { run: ExecRun; grouped: boolean; highlight: boolean; onRerun: (run: ExecRun) => void }) {
  const groups: OutputGroup[] = grouped
    ? groupIdenticalResults(run)
    : run.targets.filter((node) => run.results[node]).map((node) => ({ nodes: [node], result: run.results[node] }));
  const pendingNodes = run.targets.filter((node) => !run.results[node]);
  const finished = run.targets.length - pendingNodes.length;
  const failed = Object.values(run.results).filter(resultFailed).length;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const keys = [...groups.map((group) => group.nodes.join(",")), ...(run.done ? [] : pendingNodes)];
  const allCollapsed = keys.length > 0 && keys.every((key) => collapsed.has(key));
  const toggle = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 600 }}>
          {run.mode === "show" ? "show›" : "$"} {run.command}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {run.selection.join(", ")} · {new Date(run.startedAt).toLocaleTimeString()} · {finished}/{run.targets.length || "?"} done
          {failed > 0 ? ` · ${failed} failed` : ""}
        </Typography>
        {keys.length > 1 && (
          <Tooltip title={allCollapsed ? "Expand all" : "Collapse all"}>
            <IconButton
              size="small"
              aria-label={allCollapsed ? "Expand all outputs" : "Collapse all outputs"}
              onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(keys))}
              sx={{ width: 22, height: 22 }}
            >
              {allCollapsed ? <UnfoldMoreIcon sx={{ fontSize: 15 }} /> : <UnfoldLessIcon sx={{ fontSize: 15 }} />}
            </IconButton>
          </Tooltip>
        )}
        {run.done && (
          <Tooltip title="Run again">
            <IconButton size="small" aria-label={`Run ${run.command} again`} onClick={() => onRerun(run)} sx={{ width: 22, height: 22 }}>
              <ReplayIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {run.error && <Typography variant="caption" color="error.main" sx={{ display: "block", mb: 0.5 }}>{run.error}</Typography>}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {groups.map((group) => {
          const key = group.nodes.join(",");
          return <OutputCard key={key} nodes={group.nodes} result={group.result} open={!collapsed.has(key)} onToggle={() => toggle(key)} highlight={highlight} />;
        })}
        {!run.done && pendingNodes.map((node) => (
          <OutputCard key={`pending:${node}`} nodes={[node]} pending open={!collapsed.has(node)} onToggle={() => toggle(node)} highlight={highlight} />
        ))}
      </Box>
    </Box>
  );
}
