import { useEffect, useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography
} from "@mui/material";

import { api } from "../../api/client";
import { requestCopyLab, useCopyLabRequest } from "../../host/copyLabStore";
import type { WorkspaceEntry } from "../../lifecycle/types";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function errorText(err: unknown): string {
  const body = err instanceof Error ? err.message.replace(/^\/api\/\S+ -> \d+ /, "") : String(err);
  try { return String((JSON.parse(body) as { detail?: unknown }).detail ?? body); } catch { return body; }
}

/** Copy a lab into a workspace: fork a shared lab into your own, publish
 * yours to the shared folder, or duplicate it. */
export function CopyLabDialog() {
  const request = useCopyLabRequest();
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setName(`${request.labName}-copy`.replace(/[^A-Za-z0-9_-]/g, "-"));
    setError(null);
    void api.getWorkspaces().then((result) => {
      const list = result.workspaces as WorkspaceEntry[];
      setWorkspaces(list);
      // Default: from a shared lab into your own folder, otherwise to the shared one.
      const fromShared = list.some((ws) => ws.shared && request.topologyPath.startsWith(`${ws.path}/`));
      const preferred = fromShared ? list.find((ws) => !ws.shared) : list.find((ws) => ws.shared);
      setTarget((preferred ?? list[0])?.path ?? "");
    }).catch((err) => setError(errorText(err)));
  }, [request]);

  if (!request) return null;
  const close = () => requestCopyLab(null);
  const valid = NAME_RE.test(name) && Boolean(target);

  const copy = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.copyLab(request.topologyPath, name, target);
      close();
      request.onCopied(result.topologyRef as never);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>Copy {request.labName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select size="small" label="To workspace" value={target} onChange={(event) => setTarget(event.target.value)}>
            {workspaces.map((ws) => (
              <MenuItem key={ws.path} value={ws.path}>{ws.path}{ws.shared ? " (shared — everyone sees it)" : ""}</MenuItem>
            ))}
          </TextField>
          <TextField size="small" label="New lab name" value={name} onChange={(event) => setName(event.target.value)}
            autoFocus onFocus={(event) => event.target.select()}
            onKeyDown={(event) => { if (event.key === "Enter" && valid && !busy) void copy(); }}
            error={Boolean(name) && !NAME_RE.test(name)} helperText="Letters, digits, - and _. Becomes the folder and the lab's name." />
          <Typography variant="caption" color="text.secondary">
            Copies the topology with its layout, tours, scripts and any files in the lab folder — not netlab&apos;s generated
            files or the running state. The copy can run next to the original.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" disabled={!valid || busy} onClick={() => void copy()}>Copy and open</Button>
      </DialogActions>
    </Dialog>
  );
}
