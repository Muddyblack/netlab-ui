import { useMemo } from "react";

import type { LensBundleResult } from "../../../api/client";
import type { CanvasGeometry } from "../useCanvasGeometry";
import type { AddressFamily } from "./types";
import { center, colorFor, interpolate, visibleLabelIds, type LabelCandidate, type Point } from "./helpers";
import { buildEdgePairIndex, resolveEdgeIds, type EdgeTintMap } from "./edgeBinding";
import { SvgLabel } from "./SvgLabel";

interface AddressingLayerProps {
  bundle: LensBundleResult;
  geometry: CanvasGeometry;
  family: AddressFamily;
  hiddenAddressPools: string[];
  selectedRef: string | null;
  onSelectRef: (ref: string) => void;
}

interface SegmentPlacement {
  segmentId: string;
  color: string;
  /** Where the prefix pill sits: the real link's midpoint when we found it. */
  hub: Point;
  /** Spoke anchor per segment endpoint, index-aligned with segment.endpoints. */
  anchors: (Point | null)[];
  /** Rendered edges carrying this segment; empty means "draw spokes instead". */
  edgeIds: string[];
}

function poolHiddenTest(family: AddressFamily, hiddenAddressPools: string[]) {
  const hidden = new Set(hiddenAddressPools);
  return (poolName?: string) => Boolean(poolName && hidden.has(`pool:${family}:${poolName}`));
}

function segmentColor(segment: LensBundleResult["addressing"]["segments"][number]): string {
  return segment.warnings.length ? "#ef5350" : colorFor(segment.colorKey);
}

/**
 * Bind each visible segment to the physical link(s) it addresses, and derive the
 * label anchors from that link's real geometry where possible. A segment on a
 * bound edge no longer needs its own spokes — the edge itself carries the colour
 * — so the canvas stops showing one link as two crossing lines.
 */
function buildPlacements(
  bundle: LensBundleResult,
  geometry: CanvasGeometry,
  family: AddressFamily,
  hiddenAddressPools: string[],
): SegmentPlacement[] {
  const isHidden = poolHiddenTest(family, hiddenAddressPools);
  const pairIndex = buildEdgePairIndex(geometry);
  const placements: SegmentPlacement[] = [];

  for (const segment of bundle.addressing.segments) {
    if (isHidden(segment.pools[family])) continue;
    const nodePoints = segment.nodeIds.map((id) => center(geometry.nodes[id]));
    const known = nodePoints.filter((value): value is Point => value !== null);
    if (known.length < 2) continue;

    const edgeIds = resolveEdgeIds(geometry, pairIndex, segment.physicalEdgeIds, segment.nodeIds);
    const singleEdge = edgeIds.length === 1 ? geometry.edges[edgeIds[0]] : undefined;

    // A point-to-point segment on one rendered edge gets its anchors from that
    // edge, so pills land on the line the user can actually see. Anything else
    // (a LAN hub, a multi-edge or unresolved segment) keeps the centroid star.
    const hub = singleEdge
      ? { x: (singleEdge.startX + singleEdge.endX) / 2, y: (singleEdge.startY + singleEdge.endY) / 2 }
      : {
        x: known.reduce((sum, point) => sum + point.x, 0) / known.length,
        y: known.reduce((sum, point) => sum + point.y, 0) / known.length,
      };

    const terminals = singleEdge
      ? [
        { x: singleEdge.startX, y: singleEdge.startY },
        { x: singleEdge.endX, y: singleEdge.endY },
      ]
      : null;
    const anchors = nodePoints.map((point) => {
      if (!point) return null;
      if (!terminals) return point;
      // Pick the edge terminal on this node's side of the link.
      const [start, end] = terminals;
      const toStart = (start.x - point.x) ** 2 + (start.y - point.y) ** 2;
      const toEnd = (end.x - point.x) ** 2 + (end.y - point.y) ** 2;
      return toStart <= toEnd ? start : end;
    });

    placements.push({ segmentId: segment.id, color: segmentColor(segment), hub, anchors, edgeIds });
  }
  return placements;
}

/**
 * The tint each rendered edge should take under the addressing lens. Lives here
 * next to the placement logic that decides which segments are edge-bound, and is
 * applied to the DOM by the overlay via useEdgeTints.
 */
export function buildAddressingTints(
  bundle: LensBundleResult,
  geometry: CanvasGeometry,
  family: AddressFamily,
  hiddenAddressPools: string[],
  selectedRef: string | null,
): EdgeTintMap {
  const tints: EdgeTintMap = {};
  for (const placement of buildPlacements(bundle, geometry, family, hiddenAddressPools)) {
    const selected = selectedRef === placement.segmentId;
    for (const edgeId of placement.edgeIds) {
      tints[edgeId] = { color: placement.color, width: selected ? 6 : 4, opacity: 0.95 };
    }
  }
  return tints;
}

export function AddressingLayer({ bundle, geometry, family, hiddenAddressPools, selectedRef, onSelectRef }: AddressingLayerProps) {
  const isHidden = poolHiddenTest(family, hiddenAddressPools);
  const placements = useMemo(
    () => buildPlacements(bundle, geometry, family, hiddenAddressPools),
    [bundle, geometry, family, hiddenAddressPools],
  );
  const placementById = new Map(placements.map((placement) => [placement.segmentId, placement]));
  const segmentById = new Map(bundle.addressing.segments.map((segment) => [segment.id, segment]));

  const candidates: LabelCandidate[] = [];
  for (const placement of placements) {
    const segment = segmentById.get(placement.segmentId);
    if (!segment) continue;
    const selected = selectedRef === segment.id;
    const prefix = segment.prefixes[family];
    if (prefix) {
      candidates.push({ id: `prefix:${segment.id}`, point: placement.hub, value: prefix, priority: selected ? 100 : 80 });
    }
    if (geometry.zoom >= 0.85 || selected) {
      segment.endpoints.forEach((endpoint, index) => {
        const anchor = placement.anchors[index];
        const address = endpoint[family];
        if (!anchor || !address) return;
        candidates.push({
          id: `endpoint:${segment.id}:${endpoint.node}:${endpoint.interface}`,
          point: interpolate(anchor, placement.hub, 0.3),
          value: `${endpoint.interface || endpoint.node} ${address}`,
          priority: selected ? 100 : 30,
        });
      });
    }
  }
  if (geometry.zoom >= 0.75) {
    for (const loopback of bundle.addressing.loopbacks) {
      if (isHidden(loopback.pools[family])) continue;
      const node = geometry.nodes[loopback.node];
      const address = loopback[family];
      if (node && address) candidates.push({
        id: `loopback:${loopback.id}`,
        point: { x: node.centerX, y: node.y - 12 },
        value: `Lo ${address}`,
        priority: 50,
      });
    }
  }
  const visibleLabels = visibleLabelIds(candidates);

  return (
    <>
      {bundle.addressing.segments.map((segment) => {
        const placement = placementById.get(segment.id);
        if (!placement) return null;
        const prefix = segment.prefixes[family];
        const selected = selectedRef === segment.id;
        // Tinted edges are already clickable through React Flow's own hit area,
        // so spokes — and the stroke hit target on them — are only for segments
        // we could not bind to a rendered edge.
        const spokes = placement.edgeIds.length ? [] : placement.anchors;
        return (
          <g key={`${segment.id}:${family}`}>
            {spokes.map((anchor, index) => anchor && (
              <line
                key={segment.nodeIds[index]}
                x1={anchor.x}
                y1={anchor.y}
                x2={placement.hub.x}
                y2={placement.hub.y}
                stroke={placement.color}
                strokeWidth={selected ? 5 : 3}
                strokeOpacity={0.85}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onClick={() => onSelectRef(segment.id)}
              />
            ))}
            {prefix && visibleLabels.has(`prefix:${segment.id}`) && (
              <g style={{ pointerEvents: "all", cursor: "pointer" }} onClick={() => onSelectRef(segment.id)}>
                <SvgLabel point={placement.hub} value={prefix} color={placement.color} selected={selected} />
              </g>
            )}
            {segment.endpoints.map((endpoint, index) => {
              const anchor = placement.anchors[index];
              const address = endpoint[family];
              if (!anchor || !address) return null;
              const labelId = `endpoint:${segment.id}:${endpoint.node}:${endpoint.interface}`;
              if (!visibleLabels.has(labelId)) return null;
              return (
                <SvgLabel
                  key={`${endpoint.node}:${endpoint.interface}:${family}`}
                  point={interpolate(anchor, placement.hub, 0.3)}
                  value={`${endpoint.interface || endpoint.node} ${address}`}
                  color={placement.color}
                />
              );
            })}
          </g>
        );
      })}

      {bundle.addressing.loopbacks.map((loopback) => {
        if (isHidden(loopback.pools[family])) return null;
        const node = geometry.nodes[loopback.node];
        const address = loopback[family];
        if (!node || !address) return null;
        if (!visibleLabels.has(`loopback:${loopback.id}`)) return null;
        return (
          <SvgLabel
            key={`${loopback.id}:${family}`}
            point={{ x: node.centerX, y: node.y - 12 }}
            value={`Lo ${address}`}
            color={colorFor(loopback.pools[family] ?? loopback.id)}
          />
        );
      })}
    </>
  );
}
