import { DEMO_MODE, defaultRuntimeSnackbar, type RuntimeSnackbarState, type StartupState, type WorkspaceEntry } from "../../lifecycle/types";
import type { TopologyRef } from "../../hooks/useTabManager";
import { RunningLabsDialog } from "../dialogs/RunningLabsDialog";
import { WorkspaceDialogs } from "../WorkspaceDialogs";
import { EnvWarningBanner } from "../EnvWarningBanner";
import { RuntimeSnackbarView } from "../RuntimeSnackbarView";

type Toast = (message: string, severity?: RuntimeSnackbarState["severity"]) => void;

interface AppSecondaryDialogsProps {
  // Running labs
  runningLabsOpen: boolean;
  setRunningLabsOpen: (open: boolean) => void;
  refreshStatus: () => Promise<void>;
  fetchFiles: () => Promise<void>;
  addToast: Toast;
  getOrCreateSession: (topoRef: TopologyRef) => Promise<string | null>;
  handleDestroyLab: (sessionId: string) => Promise<void>;

  // Workspace dialogs
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  cloneOpen: boolean;
  cloneTarget: string | undefined;
  setCloneOpen: (open: boolean) => void;
  setCloneTarget: (target: string | undefined) => void;
  folderBrowserOpen: boolean;
  setFolderBrowserOpen: (open: boolean) => void;
  exampleLabsOpen: boolean;
  setExampleLabsOpen: (open: boolean) => void;
  newFolderParent: string | null;
  setNewFolderParent: (parent: string | null) => void;
  newLabDialogOpen: boolean;
  setNewLabDialogOpen: (open: boolean) => void;
  handleCreateLab: (name: string) => Promise<void>;

  // Env warning + runtime snackbar
  startup: StartupState;
  runtimeSnackbar: RuntimeSnackbarState;
  setRuntimeSnackbar: (snackbar: RuntimeSnackbarState) => void;
}

export function AppSecondaryDialogs({
  runningLabsOpen,
  setRunningLabsOpen,
  refreshStatus,
  fetchFiles,
  addToast,
  getOrCreateSession,
  handleDestroyLab,
  setWorkspaces,
  cloneOpen,
  cloneTarget,
  setCloneOpen,
  setCloneTarget,
  folderBrowserOpen,
  setFolderBrowserOpen,
  exampleLabsOpen,
  setExampleLabsOpen,
  newFolderParent,
  setNewFolderParent,
  newLabDialogOpen,
  setNewLabDialogOpen,
  handleCreateLab,
  startup,
  runtimeSnackbar,
  setRuntimeSnackbar
}: AppSecondaryDialogsProps) {
  return (
    <>
      <RunningLabsDialog
        open={runningLabsOpen}
        onClose={() => setRunningLabsOpen(false)}
        onChanged={() => { void refreshStatus(); void fetchFiles(); }}
        onToast={addToast}
        getOrCreateSession={getOrCreateSession}
        handleDestroyLab={handleDestroyLab}
      />

      <WorkspaceDialogs
        setWorkspaces={setWorkspaces}
        fetchFiles={fetchFiles}
        addToast={addToast}
        cloneOpen={cloneOpen}
        cloneTarget={cloneTarget}
        onCloneClose={() => { setCloneOpen(false); setCloneTarget(undefined); }}
        folderBrowserOpen={folderBrowserOpen}
        onFolderBrowserClose={() => setFolderBrowserOpen(false)}
        exampleLabsOpen={exampleLabsOpen}
        onExampleLabsClose={() => setExampleLabsOpen(false)}
        newFolderParent={newFolderParent}
        onNewFolderClose={() => setNewFolderParent(null)}
        newLabDialogOpen={newLabDialogOpen}
        onNewLabDialogClose={() => setNewLabDialogOpen(false)}
        onCreateLab={handleCreateLab}
      />

      <EnvWarningBanner health={DEMO_MODE ? null : startup.health} />

      <RuntimeSnackbarView snackbar={runtimeSnackbar} onClose={() => setRuntimeSnackbar(defaultRuntimeSnackbar)} />
    </>
  );
}
