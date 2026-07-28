import { useEffect, useState, type RefObject } from "react";

/** Horizontal insets that keep the dock clear of clab-ui's context-panel
 * drawer, which overlays the canvas — without this the dock's controls
 * disappear behind the panel when it is open or the window shrinks. Uses the
 * same occlusion measurement clab-ui applies to its own canvas overlays. */
export function usePanelInsets(rootRef: RefObject<HTMLDivElement | null>) {
  const [insets, setInsets] = useState({ left: 0, right: 0 });

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const container = rootRef.current?.parentElement;
      if (!container) return;
      const crect = container.getBoundingClientRect();
      let left = 0;
      let right = 0;
      const panel = document.querySelector<HTMLElement>("[data-testid='context-panel'] .MuiDrawer-paper");
      if (panel && crect.width > 0) {
        const p = panel.getBoundingClientRect();
        const overlap = Math.min(crect.right, p.right) - Math.max(crect.left, p.left);
        if (p.width > 0 && overlap > 0 && p.bottom > crect.top && p.top < crect.bottom) {
          if (p.left <= crect.left) left = overlap;
          else right = overlap;
        }
      }
      setInsets((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    // The drawer mounts/unmounts (childList) and animates/resizes via inline
    // style — observe both; measurement itself is rAF-throttled and cheap.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"]
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef]);

  return insets;
}
