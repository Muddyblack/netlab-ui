import { useMemo } from "react";

import type { LensBundleResult } from "../../../api/client";
import type { CanvasEdgeGeometry, CanvasGeometry } from "../useCanvasGeometry";
import type { RoutingLayer } from "./types";
import {
  PROTOCOL_COLORS,
  center,
  colorFor,
  convexHull,
  offsetPath,
  polylineMidpoint,
  ribbonOffsets,
  strokeWidthFor,
  visibleLabelIds,
  type LabelCandidate,
  type Point,
} from "./helpers";
import { buildEdgePairIndex, resolveEdgeIds } from "./edgeBinding";
import { SvgLabel } from "./SvgLabel";

interface ControlPlaneLayerProps {
  bundle: LensBundleResult;
  geometry: CanvasGeometry;
  routingLayers: RoutingLayer[];
  selectedRef: string | null;
  onSelectRef: (ref: string) => void;
}

interface DomainHull {
  id: string;
  label: string;
  color: string;
  path: string;
  labelPoint: Point;
}

type Adjacency = LensBundleResult["controlPlane"]["adjacencies"][number];

/**
 * An adjacency either rides along a real physical link as an offset ribbon, or —
 * when it has no single link to follow — stays the abstract chord it genuinely
 * is. A full-mesh iBGP session between non-adjacent nodes is the second case by
 * definition: there is no physical edge to colour, so drawing one would be a lie.
 */
type AdjacencyPlacement =
  | { kind: "ribbon"; adjacency: Adjacency; edge: CanvasEdgeGeometry; offset: number; anchor: Point }
  | { kind: "chord"; adjacency: Adjacency; nodePoints: Point[]; hub: Point; anchor: Point };

// Only these protocols carry a domain concept worth a bubble; BFD and EVPN
// adjacencies render as paths alone.
const HULL_LAYERS: RoutingLayer[] = ["bgp", "ospf", "isis"];

// Stable ribbon ordering across renders: a link's protocols must not swap sides
// when an unrelated adjacency appears or the selection changes.
const RIBBON_ORDER: RoutingLayer[] = ["ospf", "isis", "bgp", "evpn", "bfd"];

// One translucent bubble per routing domain (AS / OSPF area / IS-IS area)
// replaces the old per-node ring + chip, which repeated the same fact once per
// member node. A node with several OSPF areas (an ABR) belongs to several hulls.
function buildDomainHulls(bundle: LensBundleResult, geometry: CanvasGeometry, routingLayers: RoutingLayer[]): DomainHull[] {
  const hulls: DomainHull[] = [];
  HULL_LAYERS.filter((layer) => routingLayers.includes(layer)).forEach((layer, layerIndex) => {
    const members = new Map<string, string[]>();
    for (const domain of bundle.controlPlane.nodes) {
      let keys: string[] = [];
      if (layer === "bgp" && domain.bgpAs) keys = [`AS ${domain.bgpAs}`];
      else if (layer === "ospf") keys = domain.ospfAreas.map((area) => `Area ${area}`);
      else if (layer === "isis" && domain.isisArea) keys = [domain.isisArea];
      for (const key of keys) {
        const group = members.get(key);
        if (group) group.push(domain.node);
        else members.set(key, [domain.node]);
      }
    }
    // Stagger the padding per active protocol so nested bubbles stay distinct.
    const padding = 10 + layerIndex * 9;
    for (const [key, nodeIds] of members) {
      const corners: Point[] = [];
      for (const id of nodeIds) {
        const node = geometry.nodes[id];
        if (!node) continue;
        corners.push(
          { x: node.x - padding, y: node.y - padding },
          { x: node.x + node.width + padding, y: node.y - padding },
          { x: node.x + node.width + padding, y: node.y + node.height + padding },
          { x: node.x - padding, y: node.y + node.height + padding },
        );
      }
      if (!corners.length) continue;
      const hull = convexHull(corners);
      const xs = hull.map((point) => point.x);
      const minY = Math.min(...hull.map((point) => point.y));
      hulls.push({
        id: `hull:${layer}:${key}`,
        label: key,
        color: colorFor(`${layer}:${key}`),
        path: `${hull.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ")} Z`,
        labelPoint: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: minY - 16 },
      });
    }
  });
  return hulls;
}

/**
 * Bind every active adjacency to a physical link where one exists, then fan the
 * adjacencies sharing a link out into parallel ribbons. Several protocols on one
 * link is the normal case (OSPF + iBGP + BFD), which is why routing cannot simply
 * recolour the edge the way the addressing lens does.
 */
function buildAdjacencyPlacements(
  bundle: LensBundleResult,
  geometry: CanvasGeometry,
  routingLayers: RoutingLayer[],
): AdjacencyPlacement[] {
  const pairIndex = buildEdgePairIndex(geometry);
  const active = bundle.controlPlane.adjacencies.filter((adjacency) => routingLayers.includes(adjacency.protocol as RoutingLayer));

  const byEdge = new Map<string, Adjacency[]>();
  const chords: AdjacencyPlacement[] = [];
  for (const adjacency of active) {
    const nodePoints = adjacency.nodeIds
      .map((id) => center(geometry.nodes[id]))
      .filter((value): value is Point => value !== null);
    if (nodePoints.length < 2) continue;
    const edgeIds = resolveEdgeIds(geometry, pairIndex, adjacency.physicalEdgeIds, adjacency.nodeIds);
    // Exactly one link is the only unambiguous ribbon case: a session spanning
    // several links has no single curve to follow.
    if (edgeIds.length === 1 && geometry.edges[edgeIds[0]]) {
      const group = byEdge.get(edgeIds[0]);
      if (group) group.push(adjacency);
      else byEdge.set(edgeIds[0], [adjacency]);
      continue;
    }
    const hub = {
      x: nodePoints.reduce((sum, point) => sum + point.x, 0) / nodePoints.length,
      y: nodePoints.reduce((sum, point) => sum + point.y, 0) / nodePoints.length,
    };
    chords.push({ kind: "chord", adjacency, nodePoints, hub, anchor: hub });
  }

  const ribbons: AdjacencyPlacement[] = [];
  for (const [edgeId, group] of byEdge) {
    const edge = geometry.edges[edgeId];
    const sorted = [...group].sort((left, right) => (
      RIBBON_ORDER.indexOf(left.protocol as RoutingLayer) - RIBBON_ORDER.indexOf(right.protocol as RoutingLayer)
      || left.id.localeCompare(right.id)
    ));
    const offsets = ribbonOffsets(sorted.length, 6);
    sorted.forEach((adjacency, index) => {
      ribbons.push({
        kind: "ribbon",
        adjacency,
        edge,
        offset: offsets[index],
        anchor: polylineMidpoint(edge.points, offsets[index]),
      });
    });
  }
  return [...ribbons, ...chords];
}

function dashFor(adjacency: Adjacency): string | undefined {
  const protocol = adjacency.protocol as RoutingLayer;
  if (protocol === "bgp" && adjacency.sessionType?.includes("ibgp")) return "7 5";
  if (protocol === "bfd") return "2 5";
  return undefined;
}

export function ControlPlaneLayer({ bundle, geometry, routingLayers, selectedRef, onSelectRef }: ControlPlaneLayerProps) {
  const hulls = useMemo(() => buildDomainHulls(bundle, geometry, routingLayers), [bundle, geometry, routingLayers]);
  const placements = useMemo(
    () => buildAdjacencyPlacements(bundle, geometry, routingLayers),
    [bundle, geometry, routingLayers],
  );

  const markers = bundle.controlPlane.markers
    .filter((marker) => routingLayers.includes(marker.protocol as RoutingLayer))
    .map((marker) => {
      const node = geometry.nodes[marker.node];
      if (!node) return null;
      return { marker, point: { x: node.x + node.width + 12, y: node.y + 8 } };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  // A mesh of identical sessions doesn't need a pill per path — dash style and
  // colour already say "iBGP". Label the selected session always, and otherwise
  // at most one session per (protocol, session type), zoom permitting; the rest
  // go through the shared collision filter with hull and marker labels.
  const candidates: LabelCandidate[] = hulls.map((hull) => ({
    id: hull.id,
    point: hull.labelPoint,
    value: hull.label,
    priority: 70,
  }));
  for (const { marker, point } of markers) {
    candidates.push({ id: marker.id, point, value: marker.label, priority: 90 });
  }
  const labeledSessionKinds = new Set<string>();
  for (const placement of placements) {
    const { adjacency, anchor } = placement;
    const value = adjacency.sessionType || adjacency.protocol.toUpperCase();
    if (selectedRef === adjacency.id) {
      candidates.push({ id: adjacency.id, point: anchor, value, priority: 100 });
      continue;
    }
    if (geometry.zoom < 0.75) continue;
    const kind = `${adjacency.protocol}:${value}`;
    if (labeledSessionKinds.has(kind)) continue;
    labeledSessionKinds.add(kind);
    candidates.push({ id: adjacency.id, point: anchor, value, priority: 55 });
  }
  const visibleLabels = visibleLabelIds(candidates);

  return (
    <>
      {hulls.map((hull) => (
        <g key={hull.id} style={{ pointerEvents: "none" }}>
          <path
            d={hull.path}
            fill={hull.color}
            fillOpacity={0.07}
            stroke={hull.color}
            strokeOpacity={0.07}
            strokeWidth={22}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={hull.path}
            fill="none"
            stroke={hull.color}
            strokeOpacity={0.6}
            strokeWidth={1.5}
            strokeDasharray="6 6"
            strokeLinejoin="round"
          />
          {visibleLabels.has(hull.id) && <SvgLabel point={hull.labelPoint} value={hull.label} color={hull.color} />}
        </g>
      ))}

      {placements.map((placement) => {
        const { adjacency } = placement;
        const protocol = adjacency.protocol as RoutingLayer;
        const color = PROTOCOL_COLORS[protocol];
        const selected = selectedRef === adjacency.id;
        const dashed = dashFor(adjacency);
        const width = strokeWidthFor(selected, protocol);
        const opacity = protocol === "evpn" ? 0.65 : 0.88;
        return (
          <g key={adjacency.id}>
            {placement.kind === "ribbon" ? (
              <path
                d={offsetPath(placement.edge.points, placement.offset)}
                fill="none"
                stroke={color}
                strokeWidth={width}
                strokeDasharray={dashed}
                strokeOpacity={opacity}
                strokeLinecap="round"
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={() => onSelectRef(adjacency.id)}
              />
            ) : placement.nodePoints.map((point, index) => (
              <line
                key={`${adjacency.id}:${index}`}
                x1={point.x}
                y1={point.y}
                x2={placement.hub.x}
                y2={placement.hub.y}
                stroke={color}
                strokeWidth={width}
                strokeDasharray={dashed}
                strokeOpacity={opacity}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={() => onSelectRef(adjacency.id)}
              />
            ))}
            {visibleLabels.has(adjacency.id) && (
              <SvgLabel
                point={placement.anchor}
                value={adjacency.sessionType || protocol.toUpperCase()}
                color={color}
                selected={selected}
              />
            )}
          </g>
        );
      })}

      {markers.map(({ marker, point }) => visibleLabels.has(marker.id) && (
        <SvgLabel
          key={marker.id}
          point={point}
          value={marker.label}
          color={PROTOCOL_COLORS[marker.protocol as RoutingLayer]}
        />
      ))}
    </>
  );
}
