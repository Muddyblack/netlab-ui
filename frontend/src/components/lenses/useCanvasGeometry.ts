import { useEffect, useState, type RefObject } from "react";

export interface CanvasNodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasEdgeGeometry {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /**
   * The rendered edge resampled as a polyline in container space. Lenses that
   * draw *along* a link (routing ribbons) need the curve, not just its ends —
   * clab-ui edges are beziers, so a straight line between endpoints would drift
   * off the visible link in the middle exactly where labels sit.
   */
  points: CanvasPoint[];
}

// Enough samples to track a bezier without a visible kink, few enough that a
// pan re-measure stays cheap (this runs for every edge on an rAF).
const EDGE_SAMPLES = 12;

export interface CanvasGeometry {
  width: number;
  height: number;
  zoom: number;
  nodes: Record<string, CanvasNodeGeometry>;
  edges: Record<string, CanvasEdgeGeometry>;
}

const EMPTY_GEOMETRY: CanvasGeometry = { width: 0, height: 0, zoom: 1, nodes: {}, edges: {} };

/**
 * Read the rendered React Flow geometry without importing any clab-ui internals.
 * The public graph store exposes topology data but not its viewport transform;
 * rendered node bounds are the stable browser boundary for an extension layer.
 */
export function useCanvasGeometry(containerRef: RefObject<HTMLElement | null>): CanvasGeometry {
  const [geometry, setGeometry] = useState<CanvasGeometry>(EMPTY_GEOMETRY);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    let lastSignature = "";

    const measure = () => {
      frame = 0;
      const containerRect = container.getBoundingClientRect();
      const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
      const transform = viewport ? window.getComputedStyle(viewport).transform : "none";
      const zoom = transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
      const nodes: Record<string, CanvasNodeGeometry> = {};
      container.querySelectorAll<HTMLElement>(".react-flow__node[data-id]").forEach((element) => {
        const id = element.dataset.id;
        if (!id) return;
        const rect = element.getBoundingClientRect();
        const x = rect.left - containerRect.left;
        const y = rect.top - containerRect.top;
        nodes[id] = {
          x,
          y,
          width: rect.width,
          height: rect.height,
          centerX: x + rect.width / 2,
          centerY: y + rect.height / 2,
        };
      });
      // Edge endpoints let lenses bind an abstract object (an addressing
      // segment, a routing adjacency) to the physical link React Flow actually
      // drew, so an overlay can tint that link instead of drawing a second,
      // slightly-misaligned line across it. Endpoints come from the rendered
      // path rather than the ids alone because the backend's `e<N>` guess only
      // mirrors the clab projection "where possible" (see lenses/_helpers.py).
      const edges: Record<string, CanvasEdgeGeometry> = {};
      container.querySelectorAll<HTMLElement>(".react-flow__edge[data-id]").forEach((element) => {
        const id = element.dataset.id;
        const path = element.querySelector<SVGPathElement>("path.react-flow__edge-path");
        if (!id || !path) return;
        // Path coordinates live in the zoomed viewport space; the overlay SVG
        // is in unscaled container space, so map through the screen CTM.
        const matrix = path.getScreenCTM();
        if (!matrix) return;
        let points: CanvasPoint[];
        try {
          const length = path.getTotalLength();
          if (!length) return;
          points = Array.from({ length: EDGE_SAMPLES }, (_, index) => {
            const sample = path.getPointAtLength((length * index) / (EDGE_SAMPLES - 1)).matrixTransform(matrix);
            return { x: sample.x - containerRect.left, y: sample.y - containerRect.top };
          });
        } catch {
          return; // Detached or zero-length path mid-render.
        }
        const first = points[0];
        const last = points[points.length - 1];
        edges[id] = {
          id,
          startX: first.x,
          startY: first.y,
          endX: last.x,
          endY: last.y,
          points,
        };
      });
      const next = { width: containerRect.width, height: containerRect.height, zoom, nodes, edges };
      const signature = JSON.stringify(next);
      if (signature !== lastSignature) {
        lastSignature = signature;
        setGeometry(next);
      }
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(container, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      subtree: true,
    });
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(container);
    window.addEventListener("resize", schedule);
    container.addEventListener("wheel", schedule, { passive: true });
    // React Flow mutates node/viewport styles while dragging and panning, which
    // the MutationObserver above already catches. Measuring every pointermove
    // would repeatedly walk thousands of DOM nodes even while the pointer is
    // merely hovering; pointerup is only a low-cost final-position fallback.
    container.addEventListener("pointerup", schedule, { passive: true });
    measure();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      container.removeEventListener("wheel", schedule);
      container.removeEventListener("pointerup", schedule);
    };
  }, [containerRef]);

  return geometry;
}
