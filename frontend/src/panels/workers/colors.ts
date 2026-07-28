// Stable, colorblind-friendly palette. Workers are colored by index so the same
// worker keeps its color across renders — this is the palette the canvas node
// tint will reuse once clab-ui exposes a node-decoration hook.
export const WORKER_COLORS = [
  "#4C78A8",
  "#F58518",
  "#54A24B",
  "#B279A2",
  "#E45756",
  "#72B7B2",
  "#EECA3B",
  "#FF9DA6"
];

export function workerColor(index: number): string {
  return WORKER_COLORS[index % WORKER_COLORS.length];
}
