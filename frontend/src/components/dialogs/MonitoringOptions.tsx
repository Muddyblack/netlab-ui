import { useState } from "react";
import { Box, Button, FormControlLabel, Stack, Switch, TextField, Typography } from "@mui/material";

import type { MonitoringState } from "../../api/client";

export type MonitoringOptionChange = { logs?: boolean; webhook?: string; slack?: string };

/** The opt-in parts of the stack: logs (Loki + Vector) and where firing alerts are sent. They are saved in the
 * lab's topology and take effect the next time the lab is deployed. */
export function MonitoringOptions({ state, busy, onChange }: {
  state: MonitoringState;
  busy: boolean;
  onChange: (change: MonitoringOptionChange) => void;
}) {
  const [webhook, setWebhook] = useState(state.webhook);
  const [slack, setSlack] = useState(state.slack);
  const dirty = webhook.trim() !== state.webhook || slack.trim() !== state.slack;
  return (
    <>
      <Box>
        <Typography variant="subtitle2" gutterBottom>Logs</Typography>
        <FormControlLabel
          sx={{ ml: 0 }}
          control={<Switch size="small" checked={state.logs} disabled={busy} onChange={(event) => onChange({ logs: event.target.checked })} />}
          label={<Typography variant="body2">Collect device logs</Typography>}
        />
        <Typography variant="body2" color="text.secondary">
          Adds Loki and Vector and a logs dashboard. Container logs of the lab&apos;s nodes need nothing on the device;
          for syslog, point a device at <code>&lt;this host&gt;:1514</code> (UDP).
        </Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2" gutterBottom>Alert notifications</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Firing alerts always show in Grafana and at the alert rules page. Add an address to also have them delivered
          (this starts an Alertmanager).
        </Typography>
        <Stack spacing={1}>
          <TextField
            size="small"
            label="Webhook URL"
            placeholder="https://example.org/hooks/netlab"
            value={webhook}
            disabled={busy}
            onChange={(event) => setWebhook(event.target.value)}
          />
          <TextField
            size="small"
            label="Slack incoming webhook"
            placeholder="https://hooks.slack.com/services/…"
            value={slack}
            disabled={busy}
            onChange={(event) => setSlack(event.target.value)}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="contained" disabled={busy || !dirty} onClick={() => onChange({ webhook: webhook.trim(), slack: slack.trim() })}>
              Save
            </Button>
            {state.email && (
              <Typography variant="caption" color="text.secondary">
                An email target is set in the topology (<code>monitoring.alerts.notify.email</code>).
              </Typography>
            )}
          </Stack>
        </Stack>
      </Box>
    </>
  );
}
