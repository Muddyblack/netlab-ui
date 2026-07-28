import { useEffect } from "react";

// Persist and restore clab-ui's right-hand panel tab (Nodes / Annotations /
// Lenses / Groups / Plugins / Workers / Composer / Assistant) across reloads.
//
// A tab missing from PANEL_TAB_LABELS below is not merely un-remembered: the
// observer restores the saved tab whenever the selection changes, so clicking
// an unlisted tab snaps straight back. Add new panel tabs here.
//
// clab-ui owns that active tab in internal component state and exposes no prop
// or callback for it, so there is no React seam to hook. We bridge it at the DOM
// level instead: remember the last panel tab the user clicked, and re-select it
// once the panel has mounted. Everything here is defensive — if the markup ever
// changes and the tabs aren't found, it simply does nothing.

const STORAGE_KEY = "netlab-right-panel-tab";
const PANEL_TAB_LABELS = new Set([
  "nodes",
  "annotations",
  "yaml",
  "annotation json",
  "json",
  "lenses",
  "groups",
  "plugins",
  "workers",
  "composer",
  "assistant",
]);

function tabLabel(element: Element | null): string {
  return (element?.textContent ?? "").trim();
}

function isPanelTab(element: Element | null): boolean {
  return PANEL_TAB_LABELS.has(tabLabel(element).toLowerCase());
}

function panelTabs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).filter(isPanelTab);
}

// "Edit" and "Info" are clab-ui's transient, selection-driven tabs (opened by
// clicking a node/link or its "Info" context-menu action) — never one of the
// remembered PANEL_TAB_LABELS. Guard both the same way.
const TRANSIENT_TAB_LABELS = new Set(["edit", "info"]);

function editTabIsActive(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]'))
    .some((tab) => TRANSIENT_TAB_LABELS.has(tabLabel(tab).toLowerCase()));
}

export function useRightPanelTabMemory(): void {
  useEffect(() => {
    let restoreQueued = false;

    const restore = (): void => {
      // Selecting a canvas node/link (or its "Info" context-menu action)
      // intentionally opens clab-ui's transient Edit or Info tab. Never
      // replace that explicit selection with the last remembered palette tab.
      if (editTabIsActive()) return;
      const tabs = panelTabs();
      if (tabs.length === 0) return;
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { saved = null; }
      if (saved) {
        const target = tabs.find((tab) => tabLabel(tab).toLowerCase() === saved.toLowerCase());
        if (target && target.getAttribute("aria-selected") !== "true") target.click();
      }
    };

    const queueRestore = () => {
      if (restoreQueued) return;
      restoreQueued = true;
      window.requestAnimationFrame(() => {
        restoreQueued = false;
        restore();
      });
    };

    // Keep watching because clab-ui mounts the panel asynchronously. The
    // active Edit-tab guard above ensures node editing wins over restoration.
    const observer = new MutationObserver(queueRestore);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["aria-selected"],
      childList: true,
      subtree: true,
    });
    queueRestore();

    const onClick = (event: MouseEvent) => {
      const tab = (event.target as HTMLElement | null)?.closest?.('[role="tab"]') ?? null;
      if (isPanelTab(tab)) {
        try { window.localStorage.setItem(STORAGE_KEY, tabLabel(tab)); } catch { /* ignore persistence */ }
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
    };
  }, []);
}
