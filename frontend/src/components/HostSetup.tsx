import { useCallback, useEffect, useState } from "react";
import { Box, Button, Card, Stack, Typography } from "@mui/material";
import { api, type HostDiagnostics } from "../api/client";
import { CheckIcon } from "./ContainerSetup";

export function useHostDiagnostics(enabled: boolean) {
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
