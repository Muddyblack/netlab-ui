import { useSyncExternalStore } from "react";

/** A capture the user asked for from the canvas (link or node menu). */
export interface CaptureRequest {
  node: string;
  container: string;
  interface: string;
  sessionId: string | null;
  /** Topology file of the lab — a copied live-capture command uses this, as
   * sessions end with the browser tab. */
  topologyPath?: string;
  /** Start the Edgeshark + Wireshark-in-the-browser flow (needs a click). */
  openInBrowserWireshark: () => void;
}

let current: CaptureRequest | null = null;
let hosts = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Hand a capture to the mounted chooser dialog; false when none is mounted. */
export function requestCapture(request: CaptureRequest): boolean {
  if (hosts === 0) return false;
  current = request;
  emit();
  return true;
}

export function clearCaptureRequest(): void {
  current = null;
  emit();
}

/** For the one dialog that presents capture choices. */
export function useCaptureRequest(): CaptureRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      hosts += 1;
      return () => {
        listeners.delete(listener);
        hosts -= 1;
      };
    },
    () => current,
  );
}
