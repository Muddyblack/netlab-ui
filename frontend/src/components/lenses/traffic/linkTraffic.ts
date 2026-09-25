import type { Edge } from "@xyflow/react";

import type { RuntimeContainer } from "../../../host/runtimeStore";

type RuntimeInterface = NonNullable<RuntimeContainer["interfaces"]>[number];
type Stats = NonNullable<RuntimeInterface["stats"]>;

export interface LinkEnd {
  node: string;
  iface: string;
  state?: string;
  stats?: Stats;
}

export interface LinkTraffic {
  edgeId: string;
  source: LinkEnd;
  target: LinkEnd;
  /** Both directions, bits/s, from whichever end reports rates. */
  bps: number | null;
  pps: number | null;
  down: boolean;
  /** Errors + drops added since the last sample, both ends. */
  newErrors: number;
  /** Errors + drops since the interfaces came up, both ends. */
  totalErrors: number;
}

const DOWN_STATES = new Set(["down", "lowerlayerdown", "notpresent", "dormant"]);

function interfaceIndex(containers: RuntimeContainer[]): Map<string, RuntimeInterface> {
  const index = new Map<string, RuntimeInterface>();
  for (const container of containers) {
    if (container.state !== "running") continue;
    for (const iface of container.interfaces ?? []) index.set(`${container.nodeName}\u0000${iface.name}`, iface);
  }
  return index;
}

function problemCount(stats?: Stats): number {
  if (!stats) return 0;
  return (stats.rxErrors ?? 0) + (stats.txErrors ?? 0) + (stats.rxDropped ?? 0) + (stats.txDropped ?? 0);
}

function endpoint(edge: Edge, side: "source" | "target", index: Map<string, RuntimeInterface>): LinkEnd {
  const data = (edge.data ?? {}) as { sourceEndpoint?: string; targetEndpoint?: string };
  const node = side === "source" ? edge.source : edge.target;
  const iface = (side === "source" ? data.sourceEndpoint : data.targetEndpoint) ?? "";
  const runtime = index.get(`${node}\u0000${iface}`);
  return { node, iface, state: runtime?.state, stats: runtime?.stats ?? undefined };
}

/** Join the canvas links with the latest runtime sample, one row per link
 * that has at least one live endpoint. */
export function linkTraffic(edges: Edge[], containers: RuntimeContainer[]): LinkTraffic[] {
  const index = interfaceIndex(containers);
  const rows: LinkTraffic[] = [];
  for (const edge of edges) {
    const source = endpoint(edge, "source", index);
    const target = endpoint(edge, "target", index);
    if (!source.stats && !target.stats) continue;
    const measured = [source.stats, target.stats].find((stats) => typeof stats?.rxBps === "number");
    rows.push({
      edgeId: edge.id,
      source,
      target,
      bps: measured ? (measured.rxBps ?? 0) + (measured.txBps ?? 0) : null,
      pps: measured ? (measured.rxPps ?? 0) + (measured.txPps ?? 0) : null,
      down: [source.state, target.state].some((state) => state !== undefined && DOWN_STATES.has(state.toLowerCase())),
      newErrors: (source.stats?.newErrors ?? 0) + (target.stats?.newErrors ?? 0),
      totalErrors: problemCount(source.stats) + problemCount(target.stats),
    });
  }
  return rows;
}

export function formatBps(bps: number | null): string {
  if (bps === null) return "…";
  if (bps < 1000) return `${Math.round(bps)} b/s`;
  const units = ["kb/s", "Mb/s", "Gb/s"];
  let value = bps / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export const TRAFFIC_COLORS = {
  down: "#e53935",
  errors: "#e53935",
  load: ["#90caf9", "#42a5f5", "#1e88e5", "#0d47a1"],
} as const;

/** Load bucket 0..3 on a log scale: <100 kb/s, <1 Mb/s, <10 Mb/s, above. */
export function loadLevel(bps: number): number {
  if (bps < 100_000) return 0;
  if (bps < 1_000_000) return 1;
  if (bps < 10_000_000) return 2;
  return 3;
}

export function linkLabel(link: LinkTraffic): string {
  if (link.down) return "down";
  const rate = formatBps(link.bps);
  return link.newErrors > 0 ? `${rate} · ${link.newErrors} err/drop` : rate;
}
