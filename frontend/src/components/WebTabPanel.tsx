import { useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import type { OpenWebTab } from "../lifecycle/types";

const TAB_BAR_OFFSET = 45;
const PANEL_BG = "var(--clab-ui-editor-background, var(--vscode-editor-background, #1e1e1e))";

/** The tallest ancestor of clab-ui's right-hand panel tab strip that still sits on the right edge:
 * the panel itself. clab-ui has no prop for its width, so it is read from the DOM. */
function findRightPanel(): HTMLElement | null {
  const tab = document.querySelector<HTMLElement>('[role="tab"]:not([role="dialog"] [role="tab"])');
  let element = tab?.parentElement ?? null;
  while (element && element !== document.body) {
    const rect = element.getBoundingClientRect();
    if (rect.height >= window.innerHeight * 0.6 && rect.width < window.innerWidth * 0.7) return element;
    element = element.parentElement;
  }
  return null;
}

/** How far the right-hand panel reaches into `panel` from the right, so the page can stop at its edge. */
function useRightPanelInset(panel: React.RefObject<HTMLElement | null>, active: boolean): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    // A hidden tab has nothing to fit; measuring forces a layout of the whole page.
    if (!active) return undefined;
    let observed: HTMLElement | null = null;
    const observer = new ResizeObserver(() => measure());
    function measure() {
      const host = panel.current;
      const side = findRightPanel();
      if (side !== observed) {
        if (observed) observer.unobserve(observed);
        observed = side;
        if (side) observer.observe(side);
      }
      // Measure against the containing block, not the page itself: the page's own right edge
      // moves with the inset, so measuring it would flip the inset on and off on every poll.
      const container = host?.offsetParent;
      if (!container || !side) { setInset(0); return; }
      const hostRect = container.getBoundingClientRect();
      const sideRect = side.getBoundingClientRect();
      // Only a panel that overlaps the page from its right edge counts.
      setInset(sideRect.left > hostRect.left && sideRect.left < hostRect.right ? Math.round(hostRect.right - sideRect.left) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    // The panel can be opened, closed or swapped without the window resizing.
    const poll = window.setInterval(measure, 400);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.clearInterval(poll); };
  }, [panel, active]);
  return inset;
}

/** A web page (Grafana) filling the canvas area left of the right-hand panel, with a link to open it in a browser tab. */
export function WebTabPanel({ tab, active, onClose }: { tab: OpenWebTab; active: boolean; onClose: (id: string) => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inset = useRightPanelInset(ref, active);
  return (
    <div
      ref={ref}
      data-testid="web-tab-panel"
      style={{
        position: "absolute",
        top: TAB_BAR_OFFSET,
        left: 0,
        right: inset,
        bottom: 0,
        display: active ? "flex" : "none",
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        pointerEvents: "auto",
      }}
    >
      <div style={{ position: "absolute", top: 6, right: 12, zIndex: 1, display: "flex", gap: 8 }}>
        <button
          type="button"
          title="Open in a new browser tab"
          onClick={() => window.open(tab.url, "_blank", "noopener,noreferrer")}
          style={{ fontSize: 12, cursor: "pointer", background: PANEL_BG, color: "inherit", border: "1px solid rgba(128,128,128,0.5)", borderRadius: 4, padding: "2px 8px" }}
        >
          Open in browser tab ↗
        </button>
        <button
          type="button"
          onClick={() => onClose(tab.id)}
          style={{ fontSize: 12, cursor: "pointer", background: PANEL_BG, color: "inherit", border: 0, borderRadius: 4 }}
        >
          Close
        </button>
      </div>
      <iframe
        title={tab.title}
        src={tab.url}
        style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}
      />
    </div>
  );
}
