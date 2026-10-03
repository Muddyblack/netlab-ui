import type React from "react";
import type { OpenWebTab } from "../lifecycle/types";

const TAB_BAR_OFFSET = 45;
const PANEL_BG = "var(--clab-ui-editor-background, var(--vscode-editor-background, #1e1e1e))";

/** A web page (Grafana) filling the canvas area, with a link to open it in a browser tab. */
export function WebTabPanel({ tab, onClose }: { tab: OpenWebTab; onClose: (id: string) => void }): React.JSX.Element {
  return (
    <div
      data-testid="web-tab-panel"
      style={{
        position: "absolute",
        top: TAB_BAR_OFFSET,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        pointerEvents: "auto",
      }}
    >
      <div style={{ position: "absolute", top: 6, right: 12, zIndex: 1, display: "flex", gap: 8 }}>
        <a
          href={tab.url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: "inherit", opacity: 0.8, background: PANEL_BG, padding: "2px 8px", borderRadius: 4 }}
        >
          Open in browser tab
        </a>
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
