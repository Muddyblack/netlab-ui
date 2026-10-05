import { SpotlightOverlay } from "../search/SpotlightOverlay";
import { ProposalGhostOverlay } from "../agents/ProposalGhostOverlay";
import { LeaseBadge } from "./LeaseBadge";

/** Small canvas overlays tied to the open lab: search spotlight, lease timer, proposed changes. */
export function CanvasLabOverlays({ container, sessionId, onToast, onRefresh }: {
  container: HTMLElement;
  sessionId: string;
  onRefresh: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}) {
  return (
    <>
      <SpotlightOverlay container={container} sessionId={sessionId} />
      <ProposalGhostOverlay container={container} sessionId={sessionId} onApplied={onRefresh} />
      <LeaseBadge sessionId={sessionId} onToast={onToast} />
    </>
  );
}
