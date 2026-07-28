import { CloneRepoDialog } from "./dialogs/CloneRepoDialog";
import { FolderBrowserDialog } from "./dialogs/FolderBrowserDialog";
import { ExampleLabsDialog } from "./dialogs/ExampleLabsDialog";
import { NewFolderDialog } from "./dialogs/NewFolderDialog";
import { NewLabDialog } from "./dialogs/NewLabDialog";
import { api } from "../api/client";

import type { WorkspaceEntry } from "../lifecycle/types";

interface WorkspaceDialogsProps {
  setWorkspaces: (workspaces: WorkspaceEntry[]) => void;
  fetchFiles: () => Promise<void> | void;
  addToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  cloneOpen: boolean;
  cloneTarget: string | undefined;
  onCloneClose: () => void;
  folderBrowserOpen: boolean;
  onFolderBrowserClose: () => void;
  exampleLabsOpen: boolean;
  onExampleLabsClose: () => void;
  newFolderParent: string | null;
  onNewFolderClose: () => void;
  newLabDialogOpen: boolean;
  onNewLabDialogClose: () => void;
  onCreateLab: (name: string) => Promise<void>;
}

export function WorkspaceDialogs({
  setWorkspaces,
  fetchFiles,
  addToast,
  cloneOpen,
  cloneTarget,
  onCloneClose,
  folderBrowserOpen,
  onFolderBrowserClose,
  exampleLabsOpen,
  onExampleLabsClose,
  newFolderParent,
  onNewFolderClose,
  newLabDialogOpen,
  onNewLabDialogClose,
  onCreateLab,
}: WorkspaceDialogsProps) {
  const addWorkspace = async (path: string) => {
    const r = await api.addWorkspace(path);
    setWorkspaces(r.workspaces as WorkspaceEntry[]);
    void fetchFiles();
  };

  return (
    <>
      <CloneRepoDialog
        open={cloneOpen}
        onClose={onCloneClose}
        onClone={async (url) => {
          const r = await api.cloneRepo(url, cloneTarget);
          addToast(r.message || "Successfully cloned repository!", "success");
          void fetchFiles();
        }}
      />

      <FolderBrowserDialog open={folderBrowserOpen} onClose={onFolderBrowserClose} onChoose={addWorkspace} />

      <ExampleLabsDialog
        open={exampleLabsOpen}
        onClose={onExampleLabsClose}
        onClone={async (url) => {
          const r = await api.cloneRepo(url);
          addToast(r.message || "Successfully cloned repository!", "success");
          void fetchFiles();
        }}
      />

      <NewFolderDialog
        open={newFolderParent !== null}
        parentPath={newFolderParent}
        onClose={onNewFolderClose}
        onCreate={async (parentPath, name) => {
          const r = await api.makeFolder(parentPath, name);
          addToast(r.message || "Folder created", "success");
          void fetchFiles();
        }}
      />

      <NewLabDialog
        open={newLabDialogOpen}
        onClose={onNewLabDialogClose}
        onCreate={async (name) => {
          onNewLabDialogClose();
          await onCreateLab(name);
        }}
      />
    </>
  );
}
