import { Box, Chip, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ReplayIcon from "@mui/icons-material/Replay";

import type { ExecResult } from "../../api/client";
import { NodeSetChips } from "../../components/common/NodeSetChips";
import { groupIdenticalResults, resultFailed, resultText, statusLabel, type ExecRun, type OutputGroup } from "./model";

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

function OutputCard({ nodes, result, pending }: { nodes: string[]; result?: ExecResult; pending?: boolean }) {
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
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}>
        <NodeSetChips names={nodes} variant="filled" />
        <Box sx={{ flex: 1 }} />
        {pending && <CircularProgress size={12} />}
        {result && <StatusChip result={result} />}
        {result?.durationMs !== undefined && (
          <Typography variant="caption" color="text.secondary">{(result.durationMs / 1000).toFixed(1)}s</Typography>
        )}
        {result && (
          <Tooltip title="Copy output">
            <IconButton size="small" aria-label={`Copy output of ${nodes.join(", ")}`} onClick={() => void navigator.clipboard.writeText(text)} sx={{ width: 20, height: 20 }}>
              <ContentCopyIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box
        component="pre"
        sx={{ m: 0, p: 1, fontFamily: "monospace", fontSize: "0.75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 280, overflow: "auto" }}
      >
        {pending ? "…" : text || <Typography component="span" variant="caption" color="text.secondary">(no output)</Typography>}
      </Box>
    </Box>
  );
}

export function RunResults({ run, grouped, onRerun }: { run: ExecRun; grouped: boolean; onRerun: (run: ExecRun) => void }) {
  const groups: OutputGroup[] = grouped
    ? groupIdenticalResults(run)
    : run.targets.filter((node) => run.results[node]).map((node) => ({ nodes: [node], result: run.results[node] }));
  const pendingNodes = run.targets.filter((node) => !run.results[node]);
  const finished = run.targets.length - pendingNodes.length;
  const failed = Object.values(run.results).filter(resultFailed).length;

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
        {run.done && (
          <Tooltip title="Run again">
            <IconButton size="small" aria-label={`Run ${run.command} again`} onClick={() => onRerun(run)} sx={{ width: 22, height: 22 }}>
              <ReplayIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {run.error && <Typography variant="caption" color="error.main" sx={{ display: "block", mb: 0.5 }}>{run.error}</Typography>}
      <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {groups.map((group) => <OutputCard key={group.nodes.join(",")} nodes={group.nodes} result={group.result} />)}
        {!run.done && pendingNodes.map((node) => <OutputCard key={`pending:${node}`} nodes={[node]} pending />)}
      </Box>
    </Box>
  );
}
