import { useTopoViewerStore } from "@containerlab/clab-ui";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Button, IconButton, Snackbar } from "@mui/material";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { OpenTab, WorkspaceEntry } from "../lifecycle/types";

const LOCK_HINT_KEY = "netlab-ui.lockHintDismissed";

function lockHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(LOCK_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberLockHint(): void {
  try {
    window.localStorage.setItem(LOCK_HINT_KEY, "1");
  } catch {
    /* private window: the hint comes back next time */
  }
}

const insideWorkspace = (path: string, workspaces: WorkspaceEntry[]) =>
  workspaces.some((ws) => path === ws.path || path.startsWith(ws.path.replace(/\/$/, "") + "/"));

interface Props {
  sessionId: string | null | undefined;
  openTabs: OpenTab[];
  activeTabId: string | null | undefined;
  workspaces: WorkspaceEntry[];
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  isLocked: boolean;
  openLab: (ref: never) => unknown;
  toast: (message: string, severity?: "info" | "success" | "warning" | "error") => void;
}

/**
 * Two things that look like "nothing works" and are not: a lab outside every workspace is read-only (the backend
 * refuses to write there), and every lab opens locked so a stray click cannot move nodes. Say so, with the button
 * that fixes it. The lock hint goes away for good once dismissed or once the user has unlocked a lab.
 */
export function LabHints({ sessionId, openTabs, activeTabId, workspaces, setWorkspaces, isLocked, openLab, toast }: Props) {
  const [lockDismissed, setLockDismissed] = useState(lockHintDismissed);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tab = openTabs.find((t) => t.id === activeTabId && t.kind === "topology");
  const topologyRef = tab?.kind === "topology" ? tab.topologyRef : undefined;
  const yamlPath = topologyRef?.yamlPath;

  // Unlocking once is the lesson learned: stop explaining it.
  useEffect(() => {
    if (sessionId && !isLocked && !lockDismissed) {
      rememberLockHint();
      setLockDismissed(true);
    }
  }, [sessionId, isLocked, lockDismissed]);

  if (!sessionId || !yamlPath || closedFor === yamlPath) return null;

  const readOnly = workspaces.length > 0 && !insideWorkspace(yamlPath, workspaces);

  const addWorkspace = async () => {
    const folder = yamlPath.slice(0, yamlPath.lastIndexOf("/")) || "/";
    setBusy(true);
    try {
      setWorkspaces((await api.addWorkspace(folder)).workspaces);
      toast(`${folder} is now a workspace`, "success");
      await openLab(topologyRef as never); // reopen: the new session is editable
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add the folder as a workspace", "error");
    } finally {
      setBusy(false);
    }
  };

  if (readOnly) {
    return (
      <Snackbar open anchorOrigin={{ vertical: "top", horizontal: "center" }} sx={{ maxWidth: { xs: "calc(100vw - 32px)", sm: 640 } }}>
        <Alert
          severity="info"
          variant="outlined"
          sx={{ bgcolor: "background.paper", alignItems: "center" }}
          action={
            <>
              <Button color="inherit" size="small" disabled={busy} onClick={() => void addWorkspace()}>
                Add folder as workspace
              </Button>
              <IconButton aria-label="Dismiss" color="inherit" size="small" onClick={() => setClosedFor(yamlPath)}>
                <CloseIcon fontSize="inherit" />
              </IconButton>
            </>
          }
        >
          This lab is outside your workspaces, so it is read-only. Add its folder to edit it here.
        </Alert>
      </Snackbar>
    );
  }

  if (isLocked && !lockDismissed) {
    const dismiss = () => {
      rememberLockHint();
      setLockDismissed(true);
    };
    return (
      <Snackbar open anchorOrigin={{ vertical: "top", horizontal: "center" }} sx={{ maxWidth: { xs: "calc(100vw - 32px)", sm: 560 } }}>
        <Alert
          severity="info"
          variant="outlined"
          sx={{ bgcolor: "background.paper", alignItems: "center" }}
          action={
            <>
              <Button color="inherit" size="small" onClick={() => useTopoViewerStore.setState({ isLocked: false })}>
                Unlock to edit
              </Button>
              <IconButton aria-label="Dismiss" color="inherit" size="small" onClick={dismiss}>
                <CloseIcon fontSize="inherit" />
              </IconButton>
            </>
          }
        >
          This lab is locked so nothing moves by accident. Unlock it (the lock in the toolbar) to edit.
        </Alert>
      </Snackbar>
    );
  }

  return null;
}
