import { useEffect } from "react";

import type { EdgeTintMap } from "./edgeBinding";

export const TINTED_EDGE_CLASS = "netlab-lens-tinted";

const CUSTOM_PROPERTIES = [
  "--netlab-lens-color",
  "--netlab-lens-width",
  "--netlab-lens-opacity",
  "--netlab-lens-dash",
];

// Tinting has to reach into clab-ui's rendered edges, and the DOM is the only
// boundary we have (the graph store exposes topology, not React Flow's edge
// components) — the same boundary the presentation-mode dimming already uses.
// Custom properties keep the actual colours in CSS, so one static GlobalStyles
// rule covers every edge and we never fight React Flow for the style attribute
// on the path itself.
export function useEdgeTints(container: HTMLElement, tints: EdgeTintMap) {
  useEffect(() => {
    const touched = new Set<HTMLElement>();

    const clear = (element: HTMLElement) => {
      element.classList.remove(TINTED_EDGE_CLASS);
      for (const property of CUSTOM_PROPERTIES) element.style.removeProperty(property);
    };

    const apply = () => {
      frame = 0;
      for (const [id, tint] of Object.entries(tints)) {
        const element = container.querySelector<HTMLElement>(
          `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
        );
        if (!element) continue;
        element.classList.add(TINTED_EDGE_CLASS);
        element.style.setProperty("--netlab-lens-color", tint.color);
        element.style.setProperty("--netlab-lens-width", `${tint.width}px`);
        element.style.setProperty("--netlab-lens-opacity", `${tint.opacity}`);
        element.style.setProperty("--netlab-lens-dash", tint.dash ?? "none");
        touched.add(element);
      }
    };

    let frame = 0;
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    // React Flow remounts edge elements on its own schedule (selection, edge
    // updates, viewport culling), which drops our class and custom properties.
    // Re-applying on childList changes keeps the tint attached; apply() is
    // idempotent, so a spurious wake-up costs one querySelector per tinted edge.
    const observer = new MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
    apply();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      for (const element of touched) clear(element);
    };
  }, [container, tints]);
}
