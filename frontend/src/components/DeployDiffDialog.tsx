import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { DeployDiffResult, DeployPlan } from "../api/client";
import type { ValidationIssue } from "../hooks/useLabLifecycle";
import { DiffView } from "./DiffView";

function ValidationSummaryAlert({ validationIssues, errors, warnings }: {
  validationIssues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}) {
  if (validationIssues.length === 0) {
    return <Alert severity="success" variant="outlined" sx={{ mb: 2 }}>Current topology passed netlab validation.</Alert>;
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

/** Another lab already runs as this topology's netlab instance: `netlab up`
 * would refuse. Offer netlab's multilab plugin to run both side by side. */
function InstanceConflictAlert({ plan }: { plan: DeployPlan | null | undefined }) {
  const conflict = plan?.conflict;
  if (!conflict) return null;
  const id = plan?.suggestedMultilabId;
  const mono = { fontFamily: "monospace", fontSize: "0.8rem" };
  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 2, "& .MuiAlert-message": { minWidth: 0, flex: 1 } }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Another lab is already running as instance “{conflict.instanceId}”
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ ...mono, display: "block", mt: 0.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={conflict.directory}>
        {conflict.name ? `${conflict.name} · ` : ""}{conflict.directory}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {id != null
          ? <>A plain <code>netlab up</code> would stop. Run both side by side as parallel instance #{id}, or shut the other lab down first.</>
          : <>This topology sets <code>defaults.multilab.id</code> itself; change it to an unused id or shut the other lab down first.</>}
      </Typography>
      {id != null && (
        <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.75 }}>
          <Chip size="small" variant="outlined" label={<>lab name <Box component="span" sx={mono}>ml-{id}</Box></>} />
          <Chip size="small" variant="outlined" label={<>management <Box component="span" sx={mono}>192.168.{id}.0/24</Box></>} />
        </Stack>
      )}
    </Alert>
  );
}

export function DeployDiffDialog({ diff, validationIssues, labName, plan, onCancel, onDeploy }: {
  diff: DeployDiffResult | null;
  validationIssues: ValidationIssue[];
  labName?: string | null;
  plan?: DeployPlan | null;
  onCancel: () => void;
  onDeploy: (multilabId?: number) => void;
}) {
  const errors = validationIssues.filter((issue) => issue.severity === "error");
  const warnings = validationIssues.filter((issue) => issue.severity === "warning");
  const diffView = diffViewKindFor(diff);
  return (
    <Dialog open={diff !== null} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>Review changes before deploy{labName ? <> · <strong>{labName}</strong></> : null}</DialogTitle>
      <DialogContent dividers>
        <InstanceConflictAlert plan={plan} />
        <ValidationSummaryAlert validationIssues={validationIssues} errors={errors} warnings={warnings} />
        <DeployDiffBody diffView={diffView} diff={diff} />
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        {plan?.suggestedMultilabId != null ? (
          <Button variant="contained" color={errors.length ? "error" : "primary"} onClick={() => onDeploy(plan.suggestedMultilabId ?? undefined)}>
            Deploy as parallel instance #{plan.suggestedMultilabId}
          </Button>
        ) : (
          <Button variant="contained" color={errors.length ? "error" : "primary"} onClick={() => onDeploy()}>{errors.length ? "Deploy despite errors" : "Deploy with netlab up"}</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
