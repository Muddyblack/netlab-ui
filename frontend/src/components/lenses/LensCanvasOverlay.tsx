import { GlobalStyles } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";

import type { LensBundleResult, PathResult } from "../../api/client";
import { useCanvasGeometry } from "./useCanvasGeometry";
import { resolvePresentationObjects } from "./lens-canvas-overlay/helpers";
import { AddressingLayer, buildAddressingTints } from "./lens-canvas-overlay/AddressingLayer";
import { useEdgeTints, TINTED_EDGE_CLASS } from "./lens-canvas-overlay/useEdgeTints";
import type { EdgeTintMap } from "./lens-canvas-overlay/edgeBinding";
import { ControlPlaneLayer } from "./lens-canvas-overlay/ControlPlaneLayer";
import { ServicesLayer } from "./lens-canvas-overlay/ServicesLayer";
import { PhysicalLayer } from "./lens-canvas-overlay/PhysicalLayer";
import { PathsLayer } from "./lens-canvas-overlay/PathsLayer";
import { ValidationLayer } from "./lens-canvas-overlay/ValidationLayer";
import type { AddressFamily, LensId, RoutingLayer } from "./lens-canvas-overlay/types";

export type { LensId, AddressFamily, RoutingLayer } from "./lens-canvas-overlay/types";

interface LensCanvasOverlayProps {
  container: HTMLElement;
  bundle: LensBundleResult;
  lens: LensId;
  family: AddressFamily;
  hiddenAddressPools?: string[];
  routingLayers: RoutingLayer[];
  selectedRef: string | null;
  onSelectRef: (ref: string) => void;
  presentationRefs?: string[];
  dimOthers?: boolean;
  pathResult?: PathResult | null;
}

export function LensCanvasOverlay({
  container,
  bundle,
  lens,
  family,
  hiddenAddressPools = [],
  routingLayers,
  selectedRef,
  onSelectRef,
  presentationRefs = [],
  dimOthers = false,
  pathResult = null,
}: LensCanvasOverlayProps) {
  const containerRef = useRef<HTMLElement | null>(container);
  containerRef.current = container;
  const geometry = useCanvasGeometry(containerRef);
  const presentationObjects = useMemo(
    () => resolvePresentationObjects(bundle, presentationRefs),
    [bundle, presentationRefs]
  );

  useEffect(() => {
    const shouldDim = dimOthers && presentationRefs.length > 0;
    const nodeElements = container.querySelectorAll<HTMLElement>(".react-flow__node[data-id]");
    const edgeElements = container.querySelectorAll<HTMLElement>(".react-flow__edge[data-id]");
    nodeElements.forEach((element) => {
      const visible = element.dataset.id ? presentationObjects.nodes.has(element.dataset.id) : false;
      element.classList.toggle("netlab-teaching-dimmed", shouldDim && !visible);
    });
    edgeElements.forEach((element) => {
      const visible = element.dataset.id ? presentationObjects.edges.has(element.dataset.id) : false;
      element.classList.toggle("netlab-teaching-dimmed", shouldDim && !visible);
    });
    return () => {
      nodeElements.forEach((element) => element.classList.remove("netlab-teaching-dimmed"));
      edgeElements.forEach((element) => element.classList.remove("netlab-teaching-dimmed"));
    };
  }, [container, dimOthers, presentationObjects, presentationRefs.length]);

  const physical = lens === "physical";
  const addressing = lens === "addressing";
  const routing = lens === "routing";
  const services = lens === "services";
  const paths = lens === "paths";
  const validation = lens === "validation";

  // Lenses whose facts are one-per-link tint the edge React Flow already drew
  // rather than drawing a second line across it. Only the active lens
  // contributes, so an edge never has to carry two colours at once.
  const edgeTints = useMemo<EdgeTintMap>(
    () => (addressing ? buildAddressingTints(bundle, geometry, family, hiddenAddressPools, selectedRef) : {}),
    [addressing, bundle, geometry, family, hiddenAddressPools, selectedRef],
  );
  useEdgeTints(container, edgeTints);

  // Roll per-test outcomes up to a single worst-case state per node so the
  // canvas shows one clear badge instead of stacking every test on a node.
  const nodeValidationState = useMemo(() => {
    const rank: Record<string, number> = { failed: 3, warning: 2, passed: 1, unknown: 0 };
    const worst: Record<string, string> = {};
    if (!validation) return worst;
    for (const test of bundle.validation.tests) {
      for (const node of test.nodes) {
        if ((rank[test.state] ?? 0) > (rank[worst[node]] ?? -1)) worst[node] = test.state;
      }
    }
    return worst;
  }, [validation, bundle.validation.tests]);

  return (
    <>
      <GlobalStyles styles={{
        ".netlab-teaching-dimmed": {
          opacity: "0.1 !important",
          filter: "grayscale(1)",
          transition: "opacity 180ms ease, filter 180ms ease",
        },
        "@keyframes netlab-path-flow": {
          to: { strokeDashoffset: -24 },
        },
        ".netlab-path-flow": {
          animation: "netlab-path-flow 700ms linear infinite",
        },
        // The lens colour rides on the edge React Flow already drew. `!important`
        // is required, not lazy: React Flow sets the stroke inline on the path,
        // so a plain rule of ours would always lose.
        [`.${TINTED_EDGE_CLASS} .react-flow__edge-path`]: {
          stroke: "var(--netlab-lens-color) !important",
          strokeWidth: "var(--netlab-lens-width) !important",
          strokeOpacity: "var(--netlab-lens-opacity) !important",
          strokeDasharray: "var(--netlab-lens-dash) !important",
          transition: "stroke 180ms ease, stroke-width 180ms ease",
        },
      }} />
      <svg
        width={geometry.width}
        height={geometry.height}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        aria-label={`${lens} topology lens`}
        style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none", overflow: "hidden" }}
      >
        <defs>
          <filter id="netlab-label-shadow" x="-25%" y="-40%" width="150%" height="180%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity={0.35} />
          </filter>
        </defs>

        {addressing && (
          <AddressingLayer bundle={bundle} geometry={geometry} family={family} hiddenAddressPools={hiddenAddressPools} selectedRef={selectedRef} onSelectRef={onSelectRef} />
        )}

        {routing && (
          <ControlPlaneLayer bundle={bundle} geometry={geometry} routingLayers={routingLayers} selectedRef={selectedRef} onSelectRef={onSelectRef} />
        )}

        {services && (
          <ServicesLayer bundle={bundle} geometry={geometry} selectedRef={selectedRef} onSelectRef={onSelectRef} />
        )}

        {physical && <PhysicalLayer bundle={bundle} geometry={geometry} selectedRef={selectedRef} />}

        {paths && <PathsLayer geometry={geometry} pathResult={pathResult} />}

        {validation && <ValidationLayer geometry={geometry} nodeValidationState={nodeValidationState} />}
      </svg>
    </>
  );
}
