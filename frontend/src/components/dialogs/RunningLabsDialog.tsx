import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { api, type LabInstance } from "../../api/client";
import type { TopologyRef } from "../../hooks/useTabManager";
import { ForceCleanupProgressDialog } from "./ForceCleanupProgressDialog";

type InstanceAction = "cleanup" | "force-cleanup" | "forget";

interface RunningLabsDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onToast: (message: string, severity?: "info" | "success" | "warning" | "error") => void;
  /** "Shut down" opens a session for the instance's directory and runs the
   * same streamed `netlab down` flow the canvas destroy button uses, so it
   * gets the same live-log modal instead of a silent blocking fetch. */
  getOrCreateSession: (topoRef: TopologyRef) => Promise<string | null>;
  handleDestroyLab: (sessionId: string) => Promise<void>;
}

const ACTION_COPY: Record<InstanceAction, { title: string; detail: string; confirm: string }> = {
  cleanup: {
    title: "Shut down this lab?",
    detail: "Opens the lab and runs netlab down, showing live output. This stops provider resources and removes the tracking entry when successful.",
    confirm: "Shut down",
  },
  "force-cleanup": {
    title: "Force provider cleanup?",
    detail: "Runs netlab down --cleanup --force when the directory exists. For an orphaned containerlab lab, it removes the named clab resources and exact netlab tool-container prefix, then forgets the tracking record. Persistent data volumes are retained.",
    confirm: "Force cleanup",
  },
  forget: {
    title: "Forget this tracking record?",
    detail: "This only removes the selected entry from netlab's status file. It does not stop or delete containers, VMs, networks, or tools. Use it only when those resources are already gone or were cleaned manually.",
    confirm: "Forget record",
  },
};

export function RunningLabsDialog({ open, onClose, onChanged, onToast, getOrCreateSession, handleDestroyLab }: RunningLabsDialogProps) {
  const [instances, setInstances] = useState<LabInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ instance: LabInstance; action: InstanceAction } | null>(null);
  const [running, setRunning] = useState(false);
  const [forceCleanupTarget, setForceCleanupTarget] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInstances(await api.getLabInstances());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // "Shut down" hands off to the same streamed `netlab down` flow (and native
  // live-log modal) the canvas's own destroy button uses, by opening a session
  // for the instance's directory. netlab's own status tracking only records
  // the directory a lab was started from, not which file inside it — every
  // lab this app creates or opens is named topology.yml, so that's the
  // convention assumed here; an unusual custom filename surfaces as a clear
  // "couldn't open" toast rather than silently doing the wrong thing.
  const shutDown = useCallback(async (instance: LabInstance) => {
    const yamlPath = `${instance.directory.replace(/\/+$/, "")}/topology.yml`;
    const sessionId = await getOrCreateSession({
      topologyId: `standalone:local::${yamlPath}`,
      labName: instance.name,
      yamlPath,
      source: "standalone",
    });
    if (!sessionId) {
      onToast(`Could not open ${instance.name} (looked for ${yamlPath}) to shut it down.`, "error");
      return;
    }
    await handleDestroyLab(sessionId);
    await refresh();
    onChanged();
  }, [getOrCreateSession, handleDestroyLab, onChanged, onToast, refresh]);

  const runAction = useCallback(async () => {
    if (!pending) return;
    if (pending.action === "cleanup") {
      // Hands off to the native lifecycle modal immediately — no local
      // running/error state to show, that dialog owns the rest of the flow.
      setPending(null);
      void shutDown(pending.instance);
      return;
    }
    if (pending.action === "force-cleanup") {
      setPending(null);
      setForceCleanupTarget(pending.instance.id);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await api.manageLabInstance(pending.instance.id, pending.action);
      if (result.code !== 0) throw new Error(result.stderr || result.stdout || `netlab exited with code ${result.code}`);
      onToast(result.stdout || `${pending.instance.id}: action completed`, "success");
      setPending(null);
      await refresh();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(null);
    } finally {
      setRunning(false);
    }
  }, [onChanged, onToast, pending, refresh, shutDown]);

  let pendingSeverity: "error" | "warning" | "info" = "info";
  let pendingColor: "error" | "warning" | "primary" = "primary";
  if (pending?.action === "force-cleanup") {
    pendingSeverity = "warning";
    pendingColor = "warning";
  }
  if (pending?.action === "forget") {
    pendingSeverity = "error";
    pendingColor = "error";
  }
  let confirmContent = <span>Confirm</span>;
  if (pending) confirmContent = <span>{ACTION_COPY[pending.action].confirm}</span>;
  if (running) confirmContent = <CircularProgress size={18} color="inherit" />;

  return (
    <>
      <Dialog open={open} onClose={running ? undefined : onClose} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Running netlab labs</Typography>
            <Typography variant="body2" color="text.secondary">Global instances from netlab status --all</Typography>
          </Box>
          <Tooltip title="Refresh">
            <span><IconButton onClick={() => void refresh()} disabled={loading || running}><RefreshIcon /></IconButton></span>
          </Tooltip>
          <IconButton onClick={onClose} disabled={running} aria-label="close"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {error && <Alert severity="error" sx={{ whiteSpace: "pre-wrap" }}>{error}</Alert>}
            {loading && instances.length === 0 && <Box sx={{ display: "grid", placeItems: "center", py: 5 }}><CircularProgress size={28} /></Box>}
            {!loading && instances.length === 0 && <Alert severity="success">No netlab-managed lab instances are currently tracked.</Alert>}
            {instances.map((instance) => (
              <Box key={instance.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2 }}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="subtitle1" fontWeight={700}>{instance.name}</Typography>
                      <Chip size="small" label={`id: ${instance.id}`} variant="outlined" />
                      {instance.providers.map((provider) => <Chip key={provider} size="small" label={provider} />)}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.75 }}>{instance.status}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, overflowWrap: "anywhere" }}>
                      {instance.directory || "No directory recorded"}
                    </Typography>
                  </Box>
                </Stack>
                {!instance.directoryExists && (
                  <Alert
                    severity="warning"
                    variant="outlined"
                    sx={{
                      mt: 1.5,
                      bgcolor: "var(--vscode-inputValidation-warningBackground)",
                      color: "text.primary",
                      "& .MuiAlert-icon": { color: "warning.main" },
                    }}
                  >
                    The recorded directory no longer exists. Normal shutdown is unavailable. Force cleanup can recover a containerlab-only instance from its recorded name; otherwise clean resources manually and then forget the stale record.
                  </Alert>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PowerSettingsNewIcon />}
                    disabled={!instance.directoryExists || running}
                    onClick={() => setPending({ instance, action: "cleanup" })}
                    sx={{ textTransform: "none" }}
                  >
                    Shut down
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    variant="outlined"
                    startIcon={<WarningAmberIcon />}
                    disabled={running || (!instance.directoryExists && !(instance.providers.length === 1 && instance.providers[0] === "clab"))}
                    onClick={() => setPending({ instance, action: "force-cleanup" })}
                    sx={{ textTransform: "none" }}
                  >
                    Force cleanup
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    startIcon={<DeleteForeverIcon />}
                    disabled={running}
                    onClick={() => setPending({ instance, action: "forget" })}
                    sx={{ textTransform: "none" }}
                  >
                    Forget record
                  </Button>
                </Stack>
              </Box>
            ))}
            <Alert
              severity="info"
              variant="outlined"
              sx={{
                bgcolor: "var(--vscode-inputValidation-infoBackground)",
                color: "text.primary",
                "& .MuiAlert-icon": { color: "info.main" },
              }}
            >
              Recommended order: try Shut down, then Force cleanup. Forget record is only for stale tracking data and never removes provider resources.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions><Button variant="text" onClick={onClose} disabled={running} sx={{ textTransform: "none" }}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(pending)} onClose={running ? undefined : () => setPending(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{pending ? ACTION_COPY[pending.action].title : "Confirm action"}</DialogTitle>
        <DialogContent>
          <Alert
            severity={pendingSeverity}
            variant="outlined"
            sx={{ color: "text.primary" }}
          >
            {pending ? ACTION_COPY[pending.action].detail : ""}
          </Alert>
          {pending && <Typography variant="body2" sx={{ mt: 2 }}>Instance <strong>{pending.instance.id}</strong> · {pending.instance.name}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPending(null)} disabled={running} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button
            variant="contained"
            color={pendingColor}
            onClick={() => void runAction()}
            disabled={running}
          >
            {confirmContent}
          </Button>
        </DialogActions>
      </Dialog>

      <ForceCleanupProgressDialog
        open={Boolean(forceCleanupTarget)}
        instanceId={forceCleanupTarget}
        onClose={() => setForceCleanupTarget(null)}
        onDone={(success) => {
          onToast(success ? `${forceCleanupTarget}: force cleanup completed` : `${forceCleanupTarget}: force cleanup failed`, success ? "success" : "error");
          void refresh();
          onChanged();
        }}
      />
    </>
  );
}
