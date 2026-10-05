import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Box, Button, Chip, GlobalStyles, Paper, Stack, Typography } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { useEdges, useNodes } from "@containerlab/clab-ui";

import type { AssistantProposal } from "../../api/client";
import { changeCounts, placeGhosts, setShownGhosts, type Box as Rect, type ProposalChanges } from "./proposalGhost";
import { pendingProposals, useProposals } from "./proposalsStore";
import { useResolveProposal } from "./useResolveProposal";

const REMOVED = "netlab-proposal-removed";
const CHANGED = "netlab-proposal-changed";
const GHOST = { width: 64, height: 64 };
const ADD = "#2e7d32";
const REMOVE = "#d32f2f";
const CHANGE = "#ed6c02";

/** The `.react-flow__viewport` element, which carries the pan/zoom transform; ghosts drawn inside it
 * use flow coordinates and follow the canvas for free. Found again if React Flow replaces it. */
function useViewport(container: HTMLElement): HTMLElement | null {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setViewport((current) => (current?.isConnected ? current : container.querySelector<HTMLElement>(".react-flow__viewport")));
    find();
    const observer = new MutationObserver(find);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);
  return viewport;
}

/** An element of our own inside the viewport, so React never reconciles against React Flow's children. */
function useHost(viewport: HTMLElement | null): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!viewport) return undefined;
    const element = document.createElement("div");
    element.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:5";
    viewport.appendChild(element);
    setHost(element);
    return () => { element.remove(); setHost(null); };
  }, [viewport]);
  return host;
}

/** Links from before the endpoint list existed carry only source and target. */
const withEndpoints = <T extends { source: string; target: string; endpoints?: string[] }>(link: T) => ({
  ...link,
  endpoints: link.endpoints?.length ? link.endpoints : [link.source, link.target],
});

const rectOf = (node: ReturnType<typeof useNodes>[number]): Rect => ({
  x: node.position.x,
  y: node.position.y,
  width: node.measured?.width ?? node.width ?? GHOST.width,
  height: node.measured?.height ?? node.height ?? GHOST.height,
});

function GhostLayer({ changes, nodes, host }: {
  changes: ProposalChanges[];
  nodes: ReturnType<typeof useNodes>;
  host: HTMLElement;
}) {
  // Placement looks at every node, so it is redone when the proposals or the node count change, not on
  // every drag frame (which would be a pass over thousands of nodes per frame in a big lab).
  const latest = useRef(nodes);
  latest.current = nodes;
  const { ghosts, added, links, needed } = useMemo(() => {
    const existing = new Map<string, Rect>();
    for (const node of latest.current) existing.set(node.id, rectOf(node));
    const addedNodes = changes.flatMap((change) => change.nodesAdded).filter((node) => !existing.has(node.name));
    const addedLinks = changes.flatMap((change) => change.linksAdded).map(withEndpoints);
    return {
      ghosts: placeGhosts(addedNodes, addedLinks, existing, GHOST),
      added: addedNodes,
      links: addedLinks,
      needed: new Set(addedLinks.flatMap((link) => link.endpoints)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the node count is the trigger; positions are read from `latest`
  }, [changes, nodes.length]);

  useEffect(() => {
    setShownGhosts(ghosts);
    return () => setShownGhosts(new Map());
  }, [ghosts]);

  // Where the nodes a ghost link ends on are right now: one cheap pass, so the lines follow a drag.
  const live = new Map<string, Rect>();
  for (const node of nodes) if (needed.has(node.id)) live.set(node.id, rectOf(node));
  const center = (name: string) => {
    const box = live.get(name) ?? ghosts.get(name);
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  };
  // A multi-access link is drawn as a star from its first endpoint to each of the others.
  const lines = links.flatMap((link) => {
    const [first, ...others] = link.endpoints;
    const from = center(first);
    return others.flatMap((other) => {
      const to = center(other);
      return from && to ? [{ key: `${link.endpoints.join("--")}:${other}`, from, to }] : [];
    });
  });

  return createPortal(
    <>
      <svg width={1} height={1} style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}>
        {lines.map(({ key, from, to }) => (
          <line key={key} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={ADD} strokeWidth={3} strokeDasharray="8 6" strokeLinecap="round" />
        ))}
      </svg>
      {added.map((node) => {
        const box = ghosts.get(node.name);
        if (!box) return null;
        return (
          <Box key={node.name} sx={{ position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height }}>
            <Box sx={{ width: "100%", height: "100%", borderRadius: "12px", border: `2px dashed ${ADD}`,
              bgcolor: "rgba(46,125,50,0.16)", display: "grid", placeItems: "center", color: ADD, fontSize: 28, fontWeight: 700 }}>
              +
            </Box>
            <Typography sx={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", mt: 0.5, whiteSpace: "nowrap",
              fontSize: 13, fontWeight: 600, color: ADD }}>
              {node.name}{node.device ? ` · ${node.device}` : ""}
            </Typography>
          </Box>
        );
      })}
    </>,
    host,
  );
}

/** Marks the existing nodes and links a proposal removes or changes. Works on the rendered React Flow
 * DOM, like the spotlight overlay, but only touches elements as they appear or are re-rendered: a scan
 * of every rendered node on each pan frame does not survive a few thousand nodes. */
function MarkExisting({ container, changes }: { container: HTMLElement; changes: ProposalChanges[] }) {
  const edges = useEdges();
  const marks = useMemo(() => {
    const removed = new Set(changes.flatMap((change) => change.nodesRemoved));
    const changed = new Set(changes.flatMap((change) => change.nodesChanged));
    const removedEdges = new Set(changes.flatMap((change) => change.linksRemoved));
    // Links to a removed node go with it.
    if (removed.size > 0) for (const edge of edges) if (removed.has(edge.source) || removed.has(edge.target)) removedEdges.add(edge.id);
    return { removed, changed, removedEdges };
  }, [changes, edges]);

  useEffect(() => {
    const { removed, changed, removedEdges } = marks;
    const mark = (element: Element) => {
      const id = element.getAttribute("data-id") ?? "";
      if (element.classList.contains("react-flow__node")) {
        if (removed.has(id)) element.classList.add(REMOVED);
        else if (changed.has(id)) element.classList.add(CHANGED);
      } else if (element.classList.contains("react-flow__edge") && removedEdges.has(id)) {
        element.classList.add(REMOVED);
      }
    };
    container.querySelectorAll(".react-flow__node[data-id], .react-flow__edge[data-id]").forEach(mark);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        // React re-renders a node's class list and drops ours; re-add it there.
        if (record.type === "attributes") mark(record.target as Element);
        record.addedNodes.forEach((added) => {
          if (!(added instanceof Element)) return;
          mark(added);
          added.querySelectorAll(".react-flow__node[data-id], .react-flow__edge[data-id]").forEach(mark);
        });
      }
    });
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      container.querySelectorAll(`.${REMOVED}, .${CHANGED}`).forEach((element) => element.classList.remove(REMOVED, CHANGED));
    };
  }, [container, marks]);
  return null;
}

function ProposalChip({ proposal, onApplied }: { proposal: AssistantProposal; onApplied: () => void }) {
  const { working, error, resolve } = useResolveProposal(proposal, onApplied);
  return (
    <Paper elevation={4} sx={{ pointerEvents: "auto", px: 1.25, py: 0.75, maxWidth: 420, border: 1, borderColor: ADD }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Chip size="small" label="Proposed" sx={{ bgcolor: ADD, color: "#fff", fontWeight: 600 }} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{proposal.summary || "Proposed change"}</Typography>
        <Typography variant="caption" color="text.secondary">{changeCounts(proposal)}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<CloseIcon />} disabled={working} onClick={() => void resolve("reject")}>Reject</Button>
        <Button size="small" variant="contained" startIcon={<CheckIcon />} disabled={working} onClick={() => void resolve("apply")}>Apply</Button>
      </Stack>
      {error && <Alert severity="warning" sx={{ mt: 0.5 }}>{error}</Alert>}
    </Paper>
  );
}

/**
 * Draws pending edit proposals on the canvas: new nodes and links as dashed green ghosts, removed ones
 * struck in red, changed nodes in amber, with an Apply / Reject chip. The change is reviewed where it
 * happens; the agents panel only carries a one-line bar.
 */
export function ProposalGhostOverlay({ container, sessionId, onApplied }: { container: HTMLElement; sessionId: string; onApplied: () => void }) {
  const { sessionId: storeSession, proposals } = useProposals();
  const pending = useMemo(
    () => (storeSession === sessionId ? pendingProposals(proposals).filter((proposal) => proposal.kind === "edit" && proposal.changes) : []),
    [proposals, sessionId, storeSession],
  );
  // The canvas hooks live below this check: with no proposal waiting, a node drag costs this nothing.
  if (pending.length === 0) return null;
  return <ProposalGhosts container={container} pending={pending} onApplied={onApplied} />;
}

function ProposalGhosts({ container, pending, onApplied }: { container: HTMLElement; pending: AssistantProposal[]; onApplied: () => void }) {
  const nodes = useNodes();
  const viewport = useViewport(container);
  const host = useHost(viewport);
  const changes = useMemo(() => pending.map((proposal) => proposal.changes as ProposalChanges), [pending]);

  return (
    <>
      <GlobalStyles styles={{
        [`.react-flow__node.${REMOVED}`]: { opacity: "0.55 !important", filter: `drop-shadow(0 0 6px ${REMOVE})`, outline: `2px dashed ${REMOVE}`, outlineOffset: 4, borderRadius: 8 },
        [`.react-flow__node.${CHANGED}`]: { filter: `drop-shadow(0 0 6px ${CHANGE})`, outline: `2px dashed ${CHANGE}`, outlineOffset: 4, borderRadius: 8 },
        [`.react-flow__edge.${REMOVED} path`]: { stroke: `${REMOVE} !important`, strokeDasharray: "6 5", opacity: 0.9 },
      }} />
      <MarkExisting container={container} changes={changes} />
      {host && <GhostLayer changes={changes} nodes={nodes} host={host} />}
      <Stack spacing={0.75} sx={{ position: "absolute", top: 56, left: 16, zIndex: 8, pointerEvents: "none" }}>
        {pending.map((proposal) => <ProposalChip key={proposal.id} proposal={proposal} onApplied={onApplied} />)}
      </Stack>
    </>
  );
}
