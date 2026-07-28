import { useCallback, useEffect, useState } from "react";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import { MuiThemeProvider } from "@srl-labs/clab-ui/theme";
// Same font as the main app — a popped-out window otherwise falls back to the
// browser's default sans-serif and looks like a foreign page.
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";

import { api, type AssistantCapabilities } from "../../api/client";
import { AssistantPanel } from "./AssistantPanel";
import { ProviderSettingsDialog } from "./ProviderSettingsDialog";

/**
 * The assistant in its own window (`?popout=assistant&sessionId=…`).
 *
 * Useful because a conversation is long-lived while the side panel is narrow
 * and gets swapped out for Nodes/Groups/Plugins as you work. Same origin as
 * the main app, so the backend endpoint override in localStorage applies here.
 */
import { applyResolvedThemeVars, resolveThemeMode } from "../../theme";

export function AssistantPopout({ sessionId }: { sessionId: string }) {
  const [capabilities, setCapabilities] = useState<AssistantCapabilities | null>(null);
  const [failed, setFailed] = useState(false);
  const [settingsProviderId, setSettingsProviderId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshCapabilities = useCallback(() => {
    void api
      .assistantCapabilities()
      .then((value) => (value.enabled ? setCapabilities(value) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    document.title = "Assistant - netlab";
    applyResolvedThemeVars(resolveThemeMode());
    refreshCapabilities();
  }, [refreshCapabilities]);

  const handleApplied = useCallback(() => {
    try {
      const bc = new BroadcastChannel("netlab_gui_events");
      bc.postMessage({ type: "topology_changed", sessionId });
      bc.close();
    } catch { /* BroadcastChannel fallback */ }
    if (window.opener && typeof window.opener.postMessage === "function") {
      window.opener.postMessage(
        { type: "netlab_topology_changed", sessionId },
        window.location.origin
      );
    }
  }, [sessionId]);

  return (
    <MuiThemeProvider>
      <Box
        sx={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.default",
          // Same brand-accent edge the session pop-outs use, so a bare window
          // still reads as part of the netlab app.
          borderTop: "2px solid var(--clab-ui-button-background, #ff9800)",
        }}
      >
        {capabilities ? (
          <AssistantPanel
            capabilities={capabilities}
            sessionId={sessionId}
            onApplied={handleApplied}
            onPopOut={null}
            onOpenSettings={(providerId) => {
              setSettingsProviderId(providerId || undefined);
              setSettingsOpen(true);
            }}
            onCapabilitiesChanged={refreshCapabilities}
          />
        ) : (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ flex: 1 }}>
            {failed ? (
              <Typography variant="body2" color="text.secondary">
                The assistant is not available on this backend.
              </Typography>
            ) : (
              <CircularProgress size={24} />
            )}
          </Stack>
        )}
        {capabilities && (
          <ProviderSettingsDialog
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            providers={capabilities.providers ?? []}
            initialProviderId={settingsProviderId}
            onChanged={refreshCapabilities}
          />
        )}
      </Box>
    </MuiThemeProvider>
  );
}
