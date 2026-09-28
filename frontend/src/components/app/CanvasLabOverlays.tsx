import { SpotlightOverlay } from "../search/SpotlightOverlay";
import { LeaseBadge } from "./LeaseBadge";

/** Small canvas overlays tied to the open lab: search spotlight, lease timer. */
export function CanvasLabOverlays({ container, sessionId, onToast }: {
  container: HTMLElement;
  sessionId: string;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}) {
  return (
    <>
      <SpotlightOverlay container={container} sessionId={sessionId} />
      <LeaseBadge sessionId={sessionId} onToast={onToast} />
    </>
  );
}
