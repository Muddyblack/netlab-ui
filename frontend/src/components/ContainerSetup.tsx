import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Card, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import { api, type ContainerCheck, type ContainerDiagnostics } from "../api/client";

const DISMISS_KEY = "netlab-gui:container-setup-dismissed";

function CheckIcon({ check }: { check: ContainerCheck }) {
  if (check.ok) return <CheckCircleOutlineIcon color="success" sx={{ fontSize: 18, mt: "2px" }} />;
  if (check.severity === "error") return <ErrorOutlineIcon color="error" sx={{ fontSize: 18, mt: "2px" }} />;
  return <WarningAmberIcon color="warning" sx={{ fontSize: 18, mt: "2px" }} />;
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/** `docker run` flags that would fix every failing check. */
function suggestedFlags(checks: ContainerCheck[]): string {
  return checks.filter((c) => !c.ok && c.fix).map((c) => c.fix).join(" \\\n  ");
}

function useContainerDiagnostics(enabled: boolean) {
  const [data, setData] = useState<ContainerDiagnostics | null>(null);
  const load = useCallback(async (refresh = false) => {
    try { setData(await api.getContainerDiagnostics(refresh)); }
    catch { setData(null); }
  }, []);
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  return { data, reload: () => load(true) };
}

/** Settings → Environment: what the containerized UI found about its own
 * `docker run` setup. Renders nothing outside a container. */
export function ContainerSetupPanel({ active }: { active: boolean }) {
  const { data, reload } = useContainerDiagnostics(active);
  if (!data?.inContainer) return null;
  const failing = data.checks.filter((c) => !c.ok);
  const flags = suggestedFlags(data.checks);
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={650}>Container Setup</Typography>
        <Button size="small" onClick={() => void reload()}>Re-check</Button>
      </Stack>
      {!data.inspected && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          Running in a container, but it could not inspect itself through the Docker socket, so only basic
          checks ran. Set <code>NETLAB_GUI_CONTAINER</code> to this container&apos;s name if it uses a custom hostname.
        </Alert>
      )}
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
      {failing.length > 0 && flags && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Recreate the container with these extra flags to fix the issues above.
          </Typography>
          <Tooltip title="Copy flags">
            <IconButton size="small" onClick={() => copy(flags)} aria-label="Copy docker run flags">
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Box>
  );
}

/** One-time startup banner when the container setup would make deployments
 * fail. Points at Settings → Environment for the details. */
export function ContainerSetupBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const { data } = useContainerDiagnostics(!dismissed);
  const errors = data?.checks.filter((c) => !c.ok && c.severity === "error") ?? [];
  if (dismissed || !data?.inContainer || errors.length === 0) return null;
  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  return (
    // Top-centred: the bottom slot belongs to EnvWarningBanner ("netlab not
    // found"), which a misconfigured UI-only container often shows as well.
    <Box sx={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", zIndex: 2000, maxWidth: 640, width: "calc(100% - 32px)" }}>
      <Alert
        severity="error"
        variant="filled"
        sx={{ boxShadow: 4, alignItems: "center" }}
        action={
          <Stack direction="row" alignItems="center">
            <Button color="inherit" size="small" onClick={() => { onOpenSettings(); dismiss(); }}>Details</Button>
            <IconButton color="inherit" size="small" onClick={dismiss} aria-label="Dismiss container setup warning">
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        }
      >
        Container setup: {errors[0].title}
        {errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}. Lab deployments will fail until the container is recreated.
      </Alert>
    </Box>
  );
}
