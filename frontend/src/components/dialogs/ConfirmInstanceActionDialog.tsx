import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { LabInstance } from "../../api/client";

type InstanceAction = "cleanup" | "force-cleanup" | "forget";

const ACTION_COPY: Record<InstanceAction, { title: string; detail: string; confirm: string; severity: "error" | "warning" | "info"; color: "error" | "warning" | "primary" }> = {
  cleanup: {
    title: "Shut down this lab?",
    detail: "Opens the lab and runs netlab down, showing live output. This stops provider resources and removes the tracking entry when successful.",
    confirm: "Shut down",
    severity: "info",
    color: "primary",
  },
  "force-cleanup": {
    title: "Force provider cleanup?",
    detail: "Runs netlab down --cleanup --force when the directory exists. For an orphaned containerlab lab, it removes the named clab resources and exact netlab tool-container prefix, then forgets the tracking record. Persistent data volumes are retained.",
    confirm: "Force cleanup",
    severity: "warning",
    color: "warning",
  },
  forget: {
    title: "Forget this tracking record?",
    detail: "This only removes the selected entry from netlab's status file. It does not stop or delete containers, VMs, networks, or tools. Use it only when those resources are already gone or were cleaned manually.",
    confirm: "Forget record",
    severity: "error",
    color: "error",
  },
};

interface ConfirmInstanceActionDialogProps {
  pending: { instance: LabInstance; action: InstanceAction } | null;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmInstanceActionDialog({ pending, running, onCancel, onConfirm }: ConfirmInstanceActionDialogProps) {
  const copy = pending ? ACTION_COPY[pending.action] : null;
  return (
    <Dialog open={Boolean(pending)} onClose={running ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{copy?.title ?? "Confirm action"}</DialogTitle>
      <DialogContent>
        <Alert severity={copy?.severity ?? "info"} variant="outlined" sx={{ color: "text.primary" }}>
          {copy?.detail ?? ""}
        </Alert>
        {pending && <Typography variant="body2" sx={{ mt: 2 }}>Instance <strong>{pending.instance.id}</strong> · {pending.instance.name}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel} disabled={running} sx={{ textTransform: "none" }}>Cancel</Button>
        <Button variant="contained" color={copy?.color ?? "primary"} onClick={onConfirm} disabled={running}>
          {running ? <CircularProgress size={18} color="inherit" /> : (copy?.confirm ?? "Confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
