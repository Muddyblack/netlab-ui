import { useSyncExternalStore } from "react";

export interface DeleteLabRequest {
  topologyPath: string;
  labName: string;
  /** Called once the lab is gone from disk (close its tab, refresh lists). */
  onDeleted: () => void;
}

let current: DeleteLabRequest | null = null;
const listeners = new Set<() => void>();

export function requestDeleteLab(request: DeleteLabRequest | null): void {
  current = request;
  for (const listener of listeners) listener();
}

export function useDeleteLabRequest(): DeleteLabRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
