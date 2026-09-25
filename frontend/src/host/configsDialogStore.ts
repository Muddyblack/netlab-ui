import { useSyncExternalStore } from "react";

/** Which lab the running-configs dialog is showing (null = closed). */
let sessionId: string | null = null;
const listeners = new Set<() => void>();

export function openConfigsDialog(forSession: string | null): void {
  sessionId = forSession;
  for (const listener of listeners) listener();
}

export function useConfigsDialogSession(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sessionId,
  );
}
