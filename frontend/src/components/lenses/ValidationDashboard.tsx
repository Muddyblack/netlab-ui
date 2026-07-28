import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SchoolOutlinedIcon from "@mui/icons-material/SchoolOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";

import type { ValidationLens, ValidationTest } from "../../api/client";
import type { ValidationIssue } from "../../hooks/useLabLifecycle";

type TestState = ValidationTest["state"];

const STATE_META: Record<TestState, { color: string; label: string; icon: typeof CheckCircleIcon }> = {
  passed: { color: "#66bb6a", label: "Passed", icon: CheckCircleIcon },
  failed: { color: "#ef5350", label: "Failed", icon: CancelIcon },
  warning: { color: "#ffa726", label: "Warning", icon: WarningAmberIcon },
  unknown: { color: "#78909c", label: "Not run", icon: HelpOutlineIcon },
};

const KIND_LABEL: Record<ValidationTest["kind"], string> = {
  wait: "Wait",
  plugin: "Plugin",
  exec: "Exec",
  show: "Show",
  valid: "Assertion",
  custom: "Custom",
};

function StateBadge({ state, size = 20 }: { state: TestState; size?: number }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return <Icon sx={{ color: meta.color, fontSize: size }} titleAccess={meta.label} />;
}

function SummaryTile({ count, label, color, active, onClick }: {
  count: number;
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      role="button"
      onClick={onClick}
      sx={{
        flex: 1,
        minWidth: 54,
        px: 1,
        py: 0.75,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: active ? color : "divider",
        bgcolor: active ? `${color}22` : "transparent",
        cursor: "pointer",
        textAlign: "center",
        transition: "background-color 120ms ease, border-color 120ms ease",
        "&:hover": { borderColor: color },
      }}
    >
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1, color }}>{count}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Typography>
    </Box>
  );
}

interface ValidationDashboardProps {
  validation: ValidationLens;
  validationIssues: ValidationIssue[];
  selectedNode: string | null;
  running: boolean;
  onRun: () => void;
  onSelectRef: (ref: string) => void;
}

export function ValidationDashboard({
  validation,
  validationIssues,
  selectedNode,
  running,
  onRun,
  onSelectRef,
}: ValidationDashboardProps) {
  const [stateFilter, setStateFilter] = useState<TestState | "all">("all");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [training, setTraining] = useState(false);

  const scopedTests = useMemo(() => {
    let tests = validation.tests;
    if (scope === "selected" && selectedNode) {
      tests = tests.filter((test) => test.nodes.includes(selectedNode));
    }
    if (stateFilter !== "all") {
      tests = tests.filter((test) => test.state === stateFilter);
    }
    return tests;
  }, [validation.tests, scope, selectedNode, stateFilter]);

  if (!validation.available) {
    return (
      <Stack spacing={1.5}>
        <Alert severity="info" icon={<SchoolOutlinedIcon fontSize="small" />}>
          This topology has no <code>validate:</code> tests yet. Add a validation suite to your
          YAML to see structured pass/fail results here.
        </Alert>
        {validationIssues.length > 0 && (
          <Stack spacing={1}>
            <Typography variant="overline" color="text.secondary">Diagnostics</Typography>
            {validationIssues.map((issue, index) => (
              <Alert key={`${issue.entityId}:${index}`} severity={issue.severity}>{issue.message}</Alert>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }

  const { summary } = validation;
  let runLabel = "Run all tests";
  if (running) runLabel = "Running…";
  else if (scope === "selected" && selectedNode) runLabel = `Run for ${selectedNode}`;

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={0.75}>
        <SummaryTile count={summary.passed} label="Pass" color={STATE_META.passed.color} active={stateFilter === "passed"} onClick={() => setStateFilter((v) => v === "passed" ? "all" : "passed")} />
        <SummaryTile count={summary.failed} label="Fail" color={STATE_META.failed.color} active={stateFilter === "failed"} onClick={() => setStateFilter((v) => v === "failed" ? "all" : "failed")} />
        <SummaryTile count={summary.warning} label="Warn" color={STATE_META.warning.color} active={stateFilter === "warning"} onClick={() => setStateFilter((v) => v === "warning" ? "all" : "warning")} />
        <SummaryTile count={summary.unknown} label="Idle" color={STATE_META.unknown.color} active={stateFilter === "unknown"} onClick={() => setStateFilter((v) => v === "unknown" ? "all" : "unknown")} />
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center">
        <Button
          variant="contained"
          size="small"
          color="warning"
          startIcon={running ? <CircularProgress size={15} color="inherit" /> : <PlayArrowIcon />}
          disabled={running}
          onClick={onRun}
          sx={{ textTransform: "none", flexShrink: 0 }}
        >
          {runLabel}
        </Button>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={scope}
          onChange={(_event, value) => value && setScope(value)}
        >
          <ToggleButton value="all" sx={{ px: 1, py: 0.35 }}>All</ToggleButton>
          <Tooltip title={selectedNode ? `Only tests targeting ${selectedNode}` : "Select a node first"}>
            <span><ToggleButton value="selected" disabled={!selectedNode} sx={{ px: 1, py: 0.35 }}>Selected</ToggleButton></span>
          </Tooltip>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Training mode — hide commands, show only the goal">
          <ToggleButton
            value="training"
            size="small"
            selected={training}
            onChange={() => setTraining((v) => !v)}
            sx={{ px: 0.75, py: 0.35 }}
          >
            <SchoolOutlinedIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
      </Stack>

      {validation.ranAt && (
        <Typography variant="caption" color="text.secondary">
          Last run {new Date(validation.ranAt).toLocaleString()}
        </Typography>
      )}
      {!validation.hasRun && (
        <Typography variant="caption" color="text.secondary">
          Tests have not been run against a live lab yet — states show as “Not run”.
        </Typography>
      )}

      <Stack spacing={0.85}>
        {scopedTests.map((test) => {
          const meta = STATE_META[test.state];
          return (
            <Accordion
              key={test.id}
              disableGutters
              elevation={0}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: "8px !important",
                "&:before": { display: "none" },
                overflow: "hidden",
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ px: 1.25, "& .MuiAccordionSummary-content": { alignItems: "center", gap: 1, my: 0.75 } }}>
                <StateBadge state={test.state} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{test.order}. {test.name}</Typography>
                  {test.description && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{test.description}</Typography>
                  )}
                </Box>
                <Chip size="small" variant="outlined" label={KIND_LABEL[test.kind]} sx={{ height: 20, flexShrink: 0 }} />
              </AccordionSummary>
              <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
                <Stack spacing={1}>
                  {test.nodes.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {test.nodes.map((node) => (
                        <Chip key={node} size="small" label={node} onClick={() => onSelectRef(`node:${node}`)} sx={{ height: 22, cursor: "pointer" }} />
                      ))}
                    </Stack>
                  )}
                  {training ? (
                    <Alert severity="info" icon={<SchoolOutlinedIcon fontSize="small" />} sx={{ py: 0.25 }}>
                      Goal: {test.description || test.name}
                      {test.waitMessage ? ` — ${test.waitMessage}` : ""}
                    </Alert>
                  ) : (
                    <>
                      {test.action && (
                        <Box>
                          <Typography variant="overline" color="text.secondary">Action</Typography>
                          <Box component="pre" sx={{ m: 0, p: 0.75, borderRadius: 1, bgcolor: "action.hover", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{test.action}</Box>
                        </Box>
                      )}
                      {test.stopOnError && <Chip size="small" color="error" variant="outlined" label="Stops the run on failure" sx={{ height: 20 }} />}
                      {test.evidence.length > 0 && (
                        <Box>
                          <Typography variant="overline" color="text.secondary">Output</Typography>
                          <Box component="pre" sx={{ m: 0, p: 0.75, borderRadius: 1, bgcolor: "action.hover", fontSize: 11, maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{test.evidence.join("\n")}</Box>
                        </Box>
                      )}
                    </>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
        {scopedTests.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
            No tests match this filter.
          </Typography>
        )}
      </Stack>

      {validationIssues.length > 0 && (
        <Stack spacing={0.75}>
          <Typography variant="overline" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <ErrorOutlineIcon fontSize="inherit" /> Unmapped diagnostics
          </Typography>
          {validationIssues.map((issue, index) => (
            <Alert key={`${issue.entityId}:${index}`} severity={issue.severity} sx={{ py: 0.25 }}>{issue.message}</Alert>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
