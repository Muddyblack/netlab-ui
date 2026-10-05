// Labels of the tabs this app adds to clab-ui's right-hand panel. They are
// defined once, here, because useRightPanelTabMemory has to recognise them by
// their on-screen text to remember the selected tab: a tab missing from its
// list used to snap back to the previously remembered one when clicked.
// Add a new panel tab's label here and use it in useCustomPaletteTabs.

/** A tab's on-screen text without a live count: "AI agents (2)" is the "AI agents" tab. Every hook that finds a
 * panel tab by its label must use this, or it stops finding the tab while a count is shown. */
export function tabLabel(element: Element | null): string {
  return (element?.textContent ?? "").trim().replace(/\s*\(\d+\)$/, "");
}

export const PANEL_TAB_LABELS = {
  composer: "Composer",
  lenses: "Lenses",
  groups: "Groups",
  plugins: "Plugins",
  monitoring: "Monitoring",
  workers: "Workers",
  agents: "AI agents"
} as const;
