import type { AssistantProposal } from "../../api/client";

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }

/** The canvas-facing part of a pending edit proposal. */
export type ProposalChanges = NonNullable<AssistantProposal["changes"]>;

/** "+1 node · +2 links · -1 link", or "" when the proposal has no structured changes. */
export function changeCounts(proposal: AssistantProposal): string {
  const changes = proposal.changes;
  if (!changes) return "";
  const part = (sign: string, count: number, noun: string) => (count ? `${sign}${count} ${noun}${count === 1 ? "" : "s"}` : "");
  return [
    part("+", changes.nodesAdded.length, "node"),
    part("-", changes.nodesRemoved.length, "node"),
    part("~", changes.nodesChanged.length, "node"),
    part("+", changes.linksAdded.length, "link"),
    part("-", changes.linksRemoved.length, "link"),
  ].filter(Boolean).join(" · ");
}

/** Where the canvas is drawing each ghost node right now, so Apply (from the canvas chip or the panel
 * bar) can put the real nodes there. */
let shownGhosts = new Map<string, Box>();
export const setShownGhosts = (ghosts: Map<string, Box>): void => { shownGhosts = ghosts; };
export function shownGhostPositions(names: string[]): Record<string, Point> {
  const positions: Record<string, Point> = {};
  for (const name of names) {
    const box = shownGhosts.get(name);
    if (box) positions[name] = { x: box.x, y: box.y };
  }
  return positions;
}

const GHOST_GAP = 40;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + GHOST_GAP && b.x < a.x + a.width + GHOST_GAP && a.y < b.y + b.height + GHOST_GAP && b.y < a.y + a.height + GHOST_GAP;

/**
 * Where to draw each node a proposal adds. The proposal carries no coordinates (the real ones are
 * assigned on apply), so a ghost goes next to the node it links to, on the first free side, or
 * beyond the right edge of the topology when it links to nothing.
 */
export function placeGhosts(
  added: Array<{ name: string }>,
  links: Array<{ endpoints: string[] }>,
  existing: Map<string, Box>,
  size: { width: number; height: number },
): Map<string, Box> {
  const placed = new Map<string, Box>();
  const all = [...existing.values()];
  const isFree = (candidate: Box) => !all.some((other) => overlaps(candidate, other)) && ![...placed.values()].some((other) => overlaps(candidate, other));
  // Plain loops: spreading thousands of boxes into Math.max is both slow and capped by the call stack.
  let right = 0;
  let top = all.length ? Infinity : 0;
  for (const box of all) {
    right = Math.max(right, box.x + box.width);
    top = Math.min(top, box.y);
  }
  let fallbackRow = 0;

  for (const { name } of added) {
    const anchorName = links
      .filter((link) => link.endpoints.includes(name))
      .flatMap((link) => link.endpoints)
      .find((other) => other !== name && (existing.has(other) || placed.has(other)));
    const anchor = anchorName ? (existing.get(anchorName) ?? placed.get(anchorName)) : undefined;
    let box: Box | undefined;
    if (anchor) {
      const step = 140;
      const candidates: Point[] = [
        { x: anchor.x, y: anchor.y + step }, { x: anchor.x + step, y: anchor.y }, { x: anchor.x, y: anchor.y - step },
        { x: anchor.x - step, y: anchor.y }, { x: anchor.x + step, y: anchor.y + step }, { x: anchor.x - step, y: anchor.y + step },
        { x: anchor.x + step, y: anchor.y - step }, { x: anchor.x - step, y: anchor.y - step },
      ];
      box = candidates
        .map((point) => ({ ...point, ...size }))
        .find(isFree);
    }
    if (!box) box = { x: right + 160, y: top + fallbackRow++ * 140, ...size };
    placed.set(name, box);
  }
  return placed;
}
