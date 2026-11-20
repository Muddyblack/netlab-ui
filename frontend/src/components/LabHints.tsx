import { useTopoViewerStore } from "@containerlab/clab-ui";
import CloseIcon from "@mui/icons-material/Close";
import FolderOffOutlinedIcon from "@mui/icons-material/FolderOffOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { Box, Button, Fade, IconButton, Paper, Snackbar } from "@mui/material";
import { cloneElement, useEffect, useState, type ReactElement } from "react";
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
      <HintPill
        icon={<FolderOffOutlinedIcon />}
        text="Read-only: outside your workspaces"
        title="The backend only writes inside a workspace. Add this lab's folder as one to edit it here."
        action="Add folder"
        busy={busy}
        onAction={() => void addWorkspace()}
        onDismiss={() => setClosedFor(yamlPath)}
      />
    );
  }

  if (isLocked && !lockDismissed) {
    return (
      <HintPill
        icon={<LockOutlinedIcon />}
        text="Locked, so nothing moves by accident"
        title="Every lab opens locked. Unlock it here or with the red lock in the toolbar."
        action="Unlock"
        onAction={() => useTopoViewerStore.setState({ isLocked: false })}
        onDismiss={() => {
          rememberLockHint();
          setLockDismissed(true);
        }}
      />
    );
  }

  return null;
}

/** A small, quiet pill above the bottom edge (the setup notice owns the top): one line, readable in both themes, one action and a close. */
function HintPill({ icon, text, title, action, busy, onAction, onDismiss }: {
  icon: ReactElement<{ sx?: object }>;
  text: string;
  title: string;
  action: string;
  busy?: boolean;
  onAction: () => void;
  onDismiss: () => void;
}) {
  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      slots={{ transition: Fade }}
      // Under dialogs (a Snackbar sits above them by default), over the canvas.
      sx={{ bottom: { xs: 72, sm: 72 }, maxWidth: "calc(100vw - 32px)", zIndex: (theme) => theme.zIndex.modal - 1 }}
    >
      <Paper
        elevation={3}
        title={title}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          pl: 1.25,
          pr: 0.5,
          py: 0.25,
          borderRadius: 999,
          border: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          color: "text.primary",
          fontSize: "0.8rem",
          minWidth: 0,
        }}
      >
        {cloneElement(icon, { sx: { fontSize: 16, color: "error.main", flex: "none" } })}
        <Box component="span" sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
          {text}
        </Box>
        <Button size="small" disabled={busy} onClick={onAction} sx={{ minWidth: 0, px: 1, py: 0, fontSize: "0.75rem", flex: "none" }}>
          {action}
        </Button>
        <IconButton aria-label="Dismiss" size="small" onClick={onDismiss} sx={{ p: 0.25, color: "text.secondary", flex: "none" }}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Paper>
    </Snackbar>
  );
}
