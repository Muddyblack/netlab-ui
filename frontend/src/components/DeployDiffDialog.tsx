import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { DeployDiffResult } from "../api/client";
import type { ValidationIssue } from "../hooks/useLabLifecycle";
import { DiffView } from "./DiffView";

function ValidationSummaryAlert({ validationIssues, errors, warnings }: {
  validationIssues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}) {
  if (validationIssues.length === 0) {
    return <Alert severity="success" sx={{ mb: 2 }}>Current topology passed netlab validation.</Alert>;
  }
  return (
    <Alert severity={errors.length ? "error" : "warning"} icon={errors.length ? <ErrorOutlineIcon /> : <WarningAmberIcon />} sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
        Validation found {errors.length} {errors.length === 1 ? "error" : "errors"} and {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}.
      </Typography>
      <Stack spacing={0.5} sx={{ maxHeight: 150, overflow: "auto" }}>
        {validationIssues.map((issue, index) => (
          <Stack key={`${issue.entityType}:${issue.entityId}:${index}`} direction="row" spacing={0.75} alignItems="flex-start">
            <Chip size="small" color={issue.severity === "error" ? "error" : "warning"} variant="outlined" label={issue.entityId || issue.entityType} />
            <Typography variant="caption" sx={{ pt: 0.4, overflowWrap: "anywhere" }}>{issue.message}</Typography>
          </Stack>
        ))}
      </Stack>
    </Alert>
  );
}

type DiffViewKind = "first" | "unchanged" | "changed";

function diffViewKindFor(diff: DeployDiffResult | null): DiffViewKind {
  if (!diff?.baselineExists) return "first";
  if (!diff.changed) return "unchanged";
  return "changed";
}

function DeployDiffBody({ diffView, diff }: { diffView: DiffViewKind; diff: DeployDiffResult | null }) {
  if (diffView === "first") {
    return (
      <Box sx={{ py: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>This is the first recorded deployment.</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>There is no previous netlab up snapshot to compare against. The current YAML becomes the baseline after a successful deploy.</Typography>
      </Box>
    );
  }
  if (diffView === "unchanged") {
    return (
      <Box sx={{ py: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>No YAML changes since the last successful deploy.</Typography>
        {diff?.recordedAt && <Typography variant="caption" color="text.secondary">Baseline recorded {new Date(diff.recordedAt).toLocaleString()}.</Typography>}
      </Box>
    );
  }
  if (!diff) return null;
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Red lines are removed; green lines are added.</Typography>
      <DiffView diff={diff.diff} />
    </>
  );
}

export function DeployDiffDialog({ diff, validationIssues, onCancel, onDeploy }: {
  diff: DeployDiffResult | null;
  validationIssues: ValidationIssue[];
  onCancel: () => void;
  onDeploy: () => void;
}) {
  const errors = validationIssues.filter((issue) => issue.severity === "error");
  const warnings = validationIssues.filter((issue) => issue.severity === "warning");
  const diffView = diffViewKindFor(diff);
  return (
    <Dialog open={diff !== null} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Review changes before deploy</DialogTitle>
      <DialogContent dividers>
        <ValidationSummaryAlert validationIssues={validationIssues} errors={errors} warnings={warnings} />
        <DeployDiffBody diffView={diffView} diff={diff} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color={errors.length ? "error" : "primary"} onClick={onDeploy}>{errors.length ? "Deploy despite errors" : "Deploy with netlab up"}</Button>
      </DialogActions>
    </Dialog>
  );
}
