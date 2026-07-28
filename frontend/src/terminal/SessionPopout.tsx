import { Suspense, lazy, useEffect } from "react";
import { Box } from "@mui/material";
import { MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import type { SessionKind } from "../hooks/useSessionDock";
// Same font as the main app (App.tsx) — a popped-out window otherwise falls
// back to the browser's default sans-serif and looks like a foreign page.
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";

const Shell = lazy(() => import("./Shell").then((m) => ({ default: m.Shell })));
const NodeLogsPanel = lazy(() => import("./NodeLogsPanel").then((m) => ({ default: m.NodeLogsPanel })));

/** Standalone page for a single shell or log stream, rendered when the app is
 * opened with ?popout=… — the "move to its own window" target of the session
 * dock. Same origin as the main app, so the backend endpoint override in
 * localStorage applies here too. */
export function SessionPopout({ kind, node, sessionId }: { kind: SessionKind; node: string; sessionId: string }) {
  useEffect(() => {
    document.title = `${kind === "shell" ? "Shell" : "Logs"} — ${node}`;
  }, [kind, node]);

  return (
    <MuiThemeProvider>
      <Box
        sx={{
          height: "100vh",
          bgcolor: "background.default",
          // Thin brand-accent edge (same orange as the app's focus/button
          // color, set globally in index.html) — the one visual cue tying a
          // bare pop-out window back to the netlab app it came from.
          borderTop: "2px solid var(--clab-ui-button-background, #ff9800)",
        }}
      >
        <Suspense fallback={null}>
          {kind === "shell"
            ? <Shell node={node} sessionId={sessionId} onClose={() => window.close()} />
            : <NodeLogsPanel node={node} sessionId={sessionId} />}
        </Suspense>
      </Box>
    </MuiThemeProvider>
  );
}
