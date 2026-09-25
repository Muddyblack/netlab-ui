import { CaptureDialog } from "./CaptureDialog";
import { ConfigsDialog } from "./ConfigsDialog";
import { CopyLabDialog } from "./CopyLabDialog";
import { ToolsDialog } from "./ToolsDialog";

/** Dialogs opened through small module stores (host/captureStore,
 * host/configsDialogStore, host/copyLabStore, host/toolsDialogStore) from the canvas, the explorer or a lens. */
export function LabToolDialogs() {
  return (
    <>
      <CaptureDialog />
      <ConfigsDialog />
      <CopyLabDialog />
      <ToolsDialog />
    </>
  );
}
