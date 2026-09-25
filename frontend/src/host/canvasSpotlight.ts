import { useSyncExternalStore } from "react";

/** Nodes the canvas should single out (everything else is dimmed) — set by
 * lab search and the module filter, cleared from the spotlight bar. */
export interface Spotlight {
  label: string;
  nodes: string[];
}

let current: Spotlight | null = null;
const listeners = new Set<() => void>();

export function setSpotlight(next: Spotlight | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function useSpotlight(): Spotlight | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
