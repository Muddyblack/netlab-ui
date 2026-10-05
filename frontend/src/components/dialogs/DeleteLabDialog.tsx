import { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";

import { api } from "../../api/client";
import { requestDeleteLab, useDeleteLabRequest } from "../../host/deleteLabStore";

function errorText(err: unknown): string {
  const body = err instanceof Error ? err.message.replace(/^\/api\/\S+ -> \d+ /, "") : String(err);
  try { return String((JSON.parse(body) as { detail?: unknown }).detail ?? body); } catch { return body; }
}

/** Confirm, then delete a lab from disk: its whole folder when it owns one,
 * otherwise just its topology file. The backend refuses deployed labs. */
export function DeleteLabDialog() {
  const request = useDeleteLabRequest();
  const [plan, setPlan] = useState<{ deleted: string; kind: "folder" | "file" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlan(null);
    setError(null);
    if (!request) return;
    let cancelled = false;
    api.deleteLab(request.topologyPath, true).then(
      (result) => { if (!cancelled) setPlan(result); },
      (err) => { if (!cancelled) setError(errorText(err)); },
    );
    return () => { cancelled = true; };
  }, [request]);

  if (!request) return null;
  const close = () => requestDeleteLab(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteLab(request.topologyPath, false);
      close();
      request.onDeleted();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {request.labName}?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {plan && (
            <>
              <Typography variant="body2">
                {plan.kind === "folder" ? "This permanently deletes the lab folder and everything in it:" : "This permanently deletes the topology file:"}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{plan.deleted}</Typography>
              <Typography variant="caption" color="text.secondary">It cannot be undone.</Typography>
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={close}>Cancel</Button>
        <Button variant="contained" color="error" disabled={!plan || busy} onClick={() => void remove()}>Delete</Button>
      </DialogActions>
    </Dialog>
  );
}
