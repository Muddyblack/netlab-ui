import { useSyncExternalStore } from "react";

/** Which node's generated config files the dialog is showing (null = closed). */
export interface NodeConfigsTarget {
  sessionId: string;
  node: string;
}

let target: NodeConfigsTarget | null = null;
const listeners = new Set<() => void>();

export function openNodeConfigsDialog(next: NodeConfigsTarget | null): void {
  target = next;
  for (const listener of listeners) listener();
}

export function useNodeConfigsTarget(): NodeConfigsTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
  );
}
