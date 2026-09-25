import { CaptureDialog } from "./CaptureDialog";
import { ConfigsDialog } from "./ConfigsDialog";

/** Dialogs opened through small module stores (host/captureStore,
 * host/configsDialogStore) from the canvas, the explorer or a lens. */
export function LabToolDialogs() {
  return (
    <>
      <CaptureDialog />
      <ConfigsDialog />
    </>
  );
}
