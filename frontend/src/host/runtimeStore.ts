import { useSyncExternalStore } from "react";

import type { components } from "../api/generated";

export type RuntimeContainer = components["schemas"]["RuntimeContainer"];

/**
 * The latest `/api/lab/runtime` sample for the active lab. The controller's
 * poll loop already feeds this to clab-ui (which keeps only the traffic-rate
 * keys it knows); publishing it here too lets our own overlays read the
 * rest — interface state, error and drop counters — without a second poll.
 */
let containers: RuntimeContainer[] = [];
const listeners = new Set<() => void>();

export function publishRuntimeContainers(next: RuntimeContainer[]): void {
  containers = next;
  for (const listener of listeners) listener();
}

export function useRuntimeContainers(): RuntimeContainer[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => containers,
  );
}
