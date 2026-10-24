import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Card, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { api, type HostDiagnostics } from "../api/client";
import { CheckIcon } from "./ContainerSetup";

const DISMISS_KEY = "netlab-ui:host-setup-dismissed";

function useHostDiagnostics(enabled: boolean) {
  const [data, setData] = useState<HostDiagnostics | null>(null);
  const load = useCallback(async (refresh = false) => {
    try { setData(await api.getHostDiagnostics(refresh)); }
    catch { setData(null); }
  }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { data, reload: () => load(true) };
}

/** Settings → Environment: can this host deploy labs (netlab, sudo-less containerlab, Docker, workspace)?
 * Renders nothing inside a container, where Container Setup applies instead. */
export function HostSetupPanel({ active }: { active: boolean }) {
  const { data, reload } = useHostDiagnostics(active);
  if (!data || data.inContainer) return null;
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={650}>Host Setup</Typography>
        <Button size="small" onClick={() => void reload()}>Re-check</Button>
      </Stack>
      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          {data.checks.map((check) => (
            <Stack key={check.id} direction="row" spacing={1.25} alignItems="flex-start">
              <CheckIcon check={check} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>{check.title}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">{check.detail}</Typography>
                {!check.ok && check.fix && (
                  <Typography variant="caption" component="code" sx={{ fontFamily: "monospace", display: "block", mt: 0.5 }}>
                    {check.fix}
                  </Typography>
                )}
              </Box>
            </Stack>
          ))}
        </Stack>
      </Card>
    </Box>
  );
}

/** Startup banner when the host cannot deploy labs yet (first run on a fresh machine). */
export function HostSetupBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const { data } = useHostDiagnostics(!dismissed);
  const errors = data?.checks.filter((c) => !c.ok && c.severity === "error") ?? [];
  if (dismissed || !data || data.inContainer || errors.length === 0) return null;
  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  return (
    <Box sx={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 2000, maxWidth: 640, width: "calc(100% - 32px)" }}>
      <Alert
        severity="warning"
        variant="filled"
        sx={{ boxShadow: 4, alignItems: "center" }}
        action={
          <Stack direction="row" alignItems="center">
            <Button color="inherit" size="small" onClick={() => { onOpenSettings(); dismiss(); }}>Set up</Button>
            <IconButton color="inherit" size="small" onClick={dismiss} aria-label="Dismiss host setup warning">
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        }
      >
        Host setup: {errors[0].title}
        {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}. Lab deployments will fail until this is fixed.
      </Alert>
    </Box>
  );
}
