// Labels of the tabs this app adds to clab-ui's right-hand panel. They are
// defined once, here, because useRightPanelTabMemory has to recognise them by
// their on-screen text to remember the selected tab: a tab missing from its
// list used to snap back to the previously remembered one when clicked.
// Add a new panel tab's label here and use it in useCustomPaletteTabs.

export const PANEL_TAB_LABELS = {
  composer: "Composer",
  lenses: "Lenses",
  groups: "Groups",
  plugins: "Plugins",
  monitoring: "Monitoring",
  workers: "Workers",
  agents: "AI agents"
} as const;
