import { useEffect, useRef } from "react";

// clab-ui owns the right-hand palette's active tab in internal state and
// exposes no prop/callback for it (see useRightPanelTabMemory, which hits the
// same wall) — so, like that hook, this bridges at the DOM level: when a unit
// is freshly opened on the canvas, click its "Composer" tab once the palette
// has mounted it. This is a one-shot nudge, not persistent restoration — it
// never re-fires for the same unit path, so it doesn't fight a later manual
// tab choice while still on that unit.
//
// "composer" must stay listed in useRightPanelTabMemory's tracked tabs: our
// synthetic click needs to update that hook's remembered tab before its
// MutationObserver reacts to the aria-selected change, or it clicks straight
// back to the previously remembered tab and undoes this nudge.

function tabLabel(element: Element | null): string {
  return (element?.textContent ?? "").trim();
}

function findTab(label: string): HTMLElement | null {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
  return tabs.find((tab) => tabLabel(tab).toLowerCase() === label.toLowerCase()) ?? null;
}

export function useAutoOpenComposerTab(unitPath: string | null): void {
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!unitPath || unitPath === lastPath.current) return;
    lastPath.current = unitPath;

    // The tab mounts asynchronously (new session/snapshot round-trip), so poll
    // briefly rather than assuming it's already there.
    const interval = window.setInterval(() => {
      const tab = findTab("composer");
      if (!tab) return;
      if (tab.getAttribute("aria-selected") !== "true") tab.click();
      window.clearInterval(interval);
    }, 100);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 4000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [unitPath]);
}
