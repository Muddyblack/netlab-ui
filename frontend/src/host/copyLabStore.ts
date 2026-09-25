import { useSyncExternalStore } from "react";

import type { LabFileEntry } from "../api/client";

export interface CopyLabRequest {
  topologyPath: string;
  labName: string;
  /** Open the copy once it exists. */
  onCopied: (topologyRef: LabFileEntry["topologyRef"]) => void;
}

let current: CopyLabRequest | null = null;
const listeners = new Set<() => void>();

export function requestCopyLab(request: CopyLabRequest | null): void {
  current = request;
  for (const listener of listeners) listener();
}

export function useCopyLabRequest(): CopyLabRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
