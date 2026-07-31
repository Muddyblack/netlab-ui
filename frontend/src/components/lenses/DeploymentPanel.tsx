import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useState } from "react";

import type { DeploymentNodeDetail, DeploymentOverview } from "../../api/client";
import { NodeSetChips } from "../common/NodeSetChips";
import { DeploymentLogDialog } from "./DeploymentLogDialog";

const STATE_META: Record<string, { color: string; label: string }> = {
  queued: { color: "#94a3b8", label: "Queued" },
  creating: { color: "#38bdf8", label: "Creating" },
  configuring: { color: "#f59e0b", label: "Configuring" },
  ready: { color: "#22c55e", label: "Ready" },
  failed: { color: "#ef4444", label: "Failed" },
  stopping: { color: "#a78bfa", label: "Stopping" },
  stopped: { color: "#64748b", label: "Stopped" },
};

const STAGE_META: Record<string, { label: string; color: string }> = {
  preparing: { label: "Prepare", color: "#3b82f6" },
  generating: { label: "Generate configs", color: "#06b6d4" },
  creating: { label: "Create nodes", color: "#38bdf8" },
  configuring: { label: "Configure", color: "#f59e0b" },
  stopping: { label: "Stop nodes", color: "#a78bfa" },
  complete: { label: "Complete", color: "#22c55e" },
  failed: { label: "Failed", color: "#ef4444" },
};

function deploymentStages(action?: string | null): string[] {
  if (action === "down") return ["stopping", "complete"];
  if (action === "initial") return ["preparing", "configuring", "complete"];
  if (action === "create-configs") return ["preparing", "generating", "complete"];
  return ["preparing", "generating", "creating", "configuring", "complete"];
}

function StageTimeline({ deployment, onShowLog }: { deployment: DeploymentOverview; onShowLog: (stage: string) => void }) {
  const stages = deploymentStages(deployment.action);
  const failed = deployment.stage === "failed";
  const activeIndex = failed ? Math.max(0, stages.length - 2) : Math.max(0, stages.indexOf(deployment.stage));
  return (
    <Stack direction="row" alignItems="flex-start" sx={{ mt: 1.25 }}>
      {stages.map((stage, index) => {
        const complete = deployment.done && !failed ? true : index < activeIndex;
        const active = !deployment.done && index === activeIndex;
        const meta = STAGE_META[failed && index === activeIndex ? "failed" : stage];
        let color = "#64748b";
        if (active || (failed && index === activeIndex)) color = meta.color;
        if (complete) color = STATE_META.ready.color;
        return (
          <Stack key={stage} direction="row" alignItems="flex-start" sx={{ flex: index === stages.length - 1 ? "0 0 auto" : 1, minWidth: 0 }}>
            <Tooltip title={`View ${meta.label.toLowerCase()} log`}>
              <ButtonBase
                onClick={() => onShowLog(stage)}
                aria-label={`View ${meta.label} log`}
                sx={{ minWidth: 38, borderRadius: 1, py: 0.25, mx: -0.25, "&:hover": { bgcolor: alpha(color, 0.1) } }}
              >
                <Stack alignItems="center" spacing={0.4}>
                  <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: color, boxShadow: active ? `0 0 0 4px ${alpha(color, 0.18)}` : "none" }} />
                  <Typography variant="caption" sx={{ color, fontSize: "0.64rem", textAlign: "center", lineHeight: 1.15, whiteSpace: "nowrap" }}>{meta.label}</Typography>
                </Stack>
              </ButtonBase>
            </Tooltip>
            {index < stages.length - 1 && <Box sx={{ height: 2, flex: 1, mt: 0.65, mx: 0.4, bgcolor: complete ? STATE_META.ready.color : "divider" }} />}
          </Stack>
        );
      })}
    </Stack>
  );
}

function NodeInspector({ detail }: { detail: DeploymentNodeDetail }) {
  const meta = detail.state ? STATE_META[detail.state] : STATE_META.queued;
  const recap = Object.entries(detail.recap).filter(([, value]) => value > 0);
  const events = detail.events.slice(-12).reverse();
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderLeft: `3px solid ${meta.color}` }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{detail.node}</Typography>
        <Chip size="small" variant="outlined" label={meta.label} sx={{ color: meta.color, borderColor: alpha(meta.color, 0.6), bgcolor: alpha(meta.color, 0.08) }} />
      </Stack>
      {detail.currentTask && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="overline" color="text.secondary">Last task</Typography>
          <Typography variant="body2">{detail.currentTask}</Typography>
        </Box>
      )}
      {detail.lastError && <Alert severity="error" sx={{ mt: 1, py: 0.25, "& .MuiAlert-message": { overflowWrap: "anywhere" } }}>{detail.lastError}</Alert>}
      {recap.length > 0 && (
        <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 1 }}>
          {recap.map(([name, value]) => (
            <Chip
              key={name}
              size="small"
              variant="outlined"
              label={`${name} ${value}`}
              color={name === "failed" || name === "unreachable" ? "error" : "default"}
              sx={name === "changed" ? { color: "warning.main", borderColor: "warning.main" } : undefined}
            />
          ))}
        </Stack>
      )}
      {events.length > 0 && (
        <Box sx={{ mt: 1.25 }}>
          <Typography variant="overline" color="text.secondary">Recent activity</Typography>
          <Stack spacing={0.5} sx={{ mt: 0.25 }}>
            {events.map((event) => {
              const eventColor = event.status === "failed" || event.status === "fatal" || event.status === "unreachable" ? STATE_META.failed.color : "text.secondary";
              return (
                <Box key={event.sequence} sx={{ px: 0.8, py: 0.55, borderRadius: 1, bgcolor: "action.hover", minWidth: 0 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="caption" sx={{ color: eventColor, fontWeight: 600 }}>{event.status}</Typography>
                    <Typography variant="caption" color="text.disabled">#{event.sequence}</Typography>
                  </Stack>
                  {event.task && <Typography variant="caption" display="block" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.task}</Typography>}
                  {event.message && <Typography variant="caption" color="text.secondary" display="block" sx={{ overflowWrap: "anywhere" }}>{event.message}</Typography>}
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}

function statusColorFor(deployment: DeploymentOverview): string {
  if (deployment.summary.failed > 0) return STATE_META.failed.color;
  if (deployment.done) return STATE_META.ready.color;
  return STAGE_META[deployment.stage].color;
}

function statusIconFor(deployment: DeploymentOverview) {
  if (deployment.summary.failed > 0) return ErrorIcon;
  if (deployment.done) return CheckCircleIcon;
  if (deployment.running) return SyncIcon;
  return HourglassEmptyIcon;
}

function statusLabelFor(deployment: DeploymentOverview): string {
  if (deployment.running) return "Running";
  if (deployment.exitCode === 0) return "Completed successfully";
  return `Finished with exit code ${deployment.exitCode ?? "unknown"}`;
}

function NoDeploymentAlert({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Alert
      severity="info"
      action={(
        <Button
          size="small"
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={onRefresh}
          sx={{
            color: "info.light",
            borderColor: "rgba(41, 182, 246, 0.65)",
            bgcolor: "transparent",
            "&:hover": {
              borderColor: "info.light",
              bgcolor: "rgba(41, 182, 246, 0.12)",
            },
          }}
        >
          Refresh
        </Button>
      )}
    >
      No deployment run recorded yet. Start Deploy, Initial, Restart, or Create to populate this lens.
    </Alert>
  );
}

function DeploymentStatusHeader({ deployment, loading, onRefresh, onRerun, onShowLog }: {
  deployment: DeploymentOverview;
  loading: boolean;
  onRefresh: () => void;
  onRerun: () => void;
  onShowLog: (stage?: string) => void;
}) {
  const statusColor = statusColorFor(deployment);
  const StatusIcon = statusIconFor(deployment);
  const statusLabel = statusLabelFor(deployment);
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: alpha(statusColor, 0.45), bgcolor: alpha(statusColor, 0.07) }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <StatusIcon sx={{ color: statusColor, fontSize: 21 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{deployment.action ? `netlab ${deployment.action}` : "Deployment"}</Typography>
          <Typography variant="caption" color="text.secondary">
            {statusLabel}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ ml: { xs: 3.5, sm: 0 } }}>
          <Button size="small" variant="outlined" startIcon={<ArticleOutlinedIcon />} onClick={() => onShowLog()} sx={{ textTransform: "none", fontWeight: 650, borderColor: "divider", color: "text.primary" }}>Logs</Button>
          <Tooltip title="Reload deployment status">
            <span><Button size="small" variant="outlined" startIcon={loading ? <CircularProgress size={13} /> : <RefreshIcon />} disabled={loading} onClick={onRefresh} sx={{ minWidth: 0, px: 1.1, textTransform: "none", borderColor: "divider", color: "text.secondary" }}>Refresh</Button></span>
          </Tooltip>
          <Button size="small" variant="contained" startIcon={<ReplayIcon />} disabled={deployment.running} onClick={onRerun} sx={{ textTransform: "none", fontWeight: 700, boxShadow: "none", "&:hover": { boxShadow: "none" } }}>Run again</Button>
        </Stack>
      </Stack>
      <StageTimeline deployment={deployment} onShowLog={onShowLog} />
    </Paper>
  );
}

function DeploymentSummaryChips({ summaryEntries }: { summaryEntries: [string, number][] }) {
  return (
    <Stack direction="row" gap={0.5} flexWrap="wrap">
      {summaryEntries.map(([state, count]) => {
        const meta = STATE_META[state];
        return <Chip key={state} size="small" label={`${meta?.label ?? state} ${count}`} sx={{ color: meta?.color, borderColor: alpha(meta?.color ?? "#64748b", 0.55), bgcolor: alpha(meta?.color ?? "#64748b", 0.08) }} variant="outlined" />;
      })}
    </Stack>
  );
}

function FailedNodesCard({ failedNodes, onSelectNode }: { failedNodes: string[]; onSelectNode: (node: string) => void }) {
  const shownFailedNodes = failedNodes.slice(0, 200);
  return (
    <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 2 }}>
      <Typography variant="overline" sx={{ color: STATE_META.failed.color }}>Failed nodes · {failedNodes.length}</Typography>
      <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
        <NodeSetChips names={shownFailedNodes} onSelect={onSelectNode} sx={{ color: STATE_META.failed.color, borderColor: alpha(STATE_META.failed.color, 0.5) }} />
        {failedNodes.length > shownFailedNodes.length && <Chip size="small" label={`+${failedNodes.length - shownFailedNodes.length} more`} />}
      </Stack>
    </Paper>
  );
}

function SelectedNodeSection({ selectedNode, selectedDetail }: { selectedNode: string | null; selectedDetail: DeploymentNodeDetail | null }) {
  if (!selectedNode) {
    return <Typography variant="body2" color="text.secondary">Select a canvas node to inspect its Ansible recap and recent tasks.</Typography>;
  }
  if (selectedDetail?.node !== selectedNode) {
    return <Box sx={{ display: "grid", placeItems: "center", py: 2 }}><CircularProgress size={20} /></Box>;
  }
  if (selectedDetail.available) return <NodeInspector detail={selectedDetail} />;
  return <Alert severity="info">No deployment data is available for {selectedNode}.</Alert>;
}

interface DeploymentPanelProps {
  sessionId: string;
  deployment: DeploymentOverview | null;
  selectedNode: string | null;
  selectedDetail: DeploymentNodeDetail | null;
  loading: boolean;
  onRefresh: () => void;
  onRerun: () => void;
  onSelectNode: (node: string) => void;
}

export function DeploymentPanel({ sessionId, deployment, selectedNode, selectedDetail, loading, onRefresh, onRerun, onSelectNode }: DeploymentPanelProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [logSection, setLogSection] = useState<string | null>(null);
  const showLog = (section: string | null = null) => {
    setLogSection(section);
    setLogOpen(true);
  };
  if (loading && !deployment) return <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress size={24} /></Box>;
  if (!deployment?.available) return <NoDeploymentAlert onRefresh={onRefresh} />;

  const failedNodes = Object.entries(deployment.nodes).filter(([, state]) => state === "failed").map(([node]) => node);
  const summaryEntries = Object.entries(deployment.summary).filter(([name, count]) => name !== "total" && count > 0);

  return (
    <Stack spacing={1.25}>
      <DeploymentStatusHeader deployment={deployment} loading={loading} onRefresh={onRefresh} onRerun={onRerun} onShowLog={showLog} />

      {deployment.currentTask && (
        <Paper variant="outlined" sx={{ px: 1.1, py: 0.85, borderRadius: 2 }}>
          <Typography variant="overline" color="text.secondary">Current task</Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{deployment.currentTask}</Typography>
        </Paper>
      )}

      <DeploymentSummaryChips summaryEntries={summaryEntries} />

      {failedNodes.length > 0 && <FailedNodesCard failedNodes={failedNodes} onSelectNode={onSelectNode} />}

      <Divider />
      <Typography variant="overline" color="text.secondary">Selected node</Typography>
      <SelectedNodeSection selectedNode={selectedNode} selectedDetail={selectedDetail} />

      <DeploymentLogDialog sessionId={sessionId} open={logOpen} initialSection={logSection} onClose={() => setLogOpen(false)} />
    </Stack>
  );
}
