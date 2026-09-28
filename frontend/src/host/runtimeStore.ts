import { useSyncExternalStore } from "react";

import type { components } from "../api/generated";

export type RuntimeContainer = components["schemas"]["RuntimeContainer"];

/** One rate sample of an interface, bits/s as seen by that interface. */
export interface RateSample {
  t: number;
  rx: number;
  tx: number;
}

/** 3 s poll × 120 = the last six minutes. */
const HISTORY_SAMPLES = 120;

/**
 * The latest `/api/lab/runtime` sample for the active lab. The controller's
 * poll loop already feeds this to clab-ui (which keeps only the traffic-rate
 * keys it knows); publishing it here too lets our own overlays read the
 * rest — interface state, error and drop counters — without a second poll.
 * It also keeps a short rate history per interface for the traffic charts.
 */
let state: { containers: RuntimeContainer[]; history: Map<string, RateSample[]> } = {
  containers: [],
  history: new Map(),
};
const listeners = new Set<() => void>();

export function interfaceKey(node: string, iface: string): string {
  return `${node}\u0000${iface}`;
}

export function publishRuntimeContainers(next: RuntimeContainer[]): void {
  const now = Date.now();
  const history = new Map(next.length ? state.history : []);
  for (const container of next) {
    if (container.state !== "running") continue;
    for (const iface of container.interfaces ?? []) {
      const stats = iface.stats;
      if (typeof stats?.rxBps !== "number" || typeof stats.txBps !== "number") continue;
      const key = interfaceKey(container.nodeName, iface.name);
      const samples = [...(history.get(key) ?? []), { t: now, rx: stats.rxBps, tx: stats.txBps }];
      history.set(key, samples.slice(-HISTORY_SAMPLES));
    }
  }
  state = { containers: next, history };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRuntimeContainers(): RuntimeContainer[] {
  return useSyncExternalStore(subscribe, () => state.containers);
}

export function useRateHistory(): Map<string, RateSample[]> {
  return useSyncExternalStore(subscribe, () => state.history);
}
