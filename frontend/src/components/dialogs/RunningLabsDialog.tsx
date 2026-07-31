import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { api, type LabInstance } from "../../api/client";
import type { TopologyRef } from "../../hooks/useTabManager";
import { ForceCleanupProgressDialog } from "./ForceCleanupProgressDialog";
import { RunningLabInstanceCard } from "./RunningLabInstanceCard";
import { ConfirmInstanceActionDialog } from "./ConfirmInstanceActionDialog";

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
              <RunningLabInstanceCard
                key={instance.id}
                instance={instance}
                running={running}
                onAction={(inst, action) => setPending({ instance: inst, action })}
              />
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

      <ConfirmInstanceActionDialog
        pending={pending}
        running={running}
        onCancel={() => setPending(null)}
        onConfirm={() => void runAction()}
      />

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
