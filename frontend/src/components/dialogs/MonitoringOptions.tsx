import { useState } from "react";
import { Box, Button, Stack, Switch, TextField, Tooltip } from "@mui/material";

import type { MonitoringState } from "../../api/client";
import { SetupSection } from "./SetupSection";

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
  const targets = [state.webhook && "Webhook", state.slack && "Slack", state.email && "Email"].filter(Boolean).join(" · ");
  return (
    <>
      <SetupSection
        title="Device logs"
        value={state.logs ? "On" : "Off"}
        action={
          <Tooltip title={<>Loki + Vector and a logs dashboard. Syslog: send to <code>&lt;this host&gt;:1514</code> (UDP). Applies on next deploy.</>}>
            <Switch size="small" checked={state.logs} disabled={busy} onChange={(event) => onChange({ logs: event.target.checked })} />
          </Tooltip>
        }
      />
      <SetupSection title="Alert delivery" value={targets || "Grafana only"}>
        <Stack spacing={1.25}>
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
            label="Slack webhook"
            placeholder="https://hooks.slack.com/services/…"
            value={slack}
            disabled={busy}
            onChange={(event) => setSlack(event.target.value)}
          />
          <Box>
            <Button size="small" variant="contained" disabled={busy || !dirty} onClick={() => onChange({ webhook: webhook.trim(), slack: slack.trim() })}>
              Save
            </Button>
          </Box>
        </Stack>
      </SetupSection>
    </>
  );
}
