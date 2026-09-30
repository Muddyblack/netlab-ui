import { AgentGuideCard } from "../agents/AgentGuideCard";
import { CaptureDialog } from "./CaptureDialog";
import { ConfigsDialog } from "./ConfigsDialog";
import { CopyLabDialog } from "./CopyLabDialog";
import { MonitoringDialog } from "./MonitoringDialog";
import { ToolsDialog } from "./ToolsDialog";

/** Dialogs opened through small module stores (host/captureStore,
 * host/configsDialogStore, host/copyLabStore, host/toolsDialogStore, host/monitoringDialogStore) from the canvas,
 * the explorer or a lens. */
export function LabToolDialogs() {
  return (
    <>
      <CaptureDialog />
      <ConfigsDialog />
      <CopyLabDialog />
      <MonitoringDialog />
      <ToolsDialog />
      <AgentGuideCard />
    </>
  );
}
