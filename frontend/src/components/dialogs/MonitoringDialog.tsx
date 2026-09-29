import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, MenuItem,
  Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";

import { api, type MonitoringState, type MonitoringSummary } from "../../api/client";
import { openMonitoringDialog, useMonitoringDialogRequest } from "../../host/monitoringDialogStore";

const METHOD_HELP: Record<string, string> = {
  host: "CPU, memory and interface counters read on the lab host (any container or libvirt VM)",
  frr: "OSPF, IS-IS, BGP, BFD and routes from the FRR daemons' sockets (no network needed)",
  gnmi: "gNMI streaming telemetry (OpenConfig / SR Linux) over the management network",
  snmp: "SNMP interface counters over the management network",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stackStatus(state: MonitoringState): { label: string; color: "success" | "warning" | "default" | "error" } {
  if (!state.enabled) return state.rendered ? { label: "Turned off — stops on next deploy", color: "default" } : { label: "Off", color: "default" };
  if (!state.labDeployed) return { label: "Starts when the lab is deployed", color: "default" };
  if (!state.rendered) return { label: "Starts on the next deploy", color: "warning" };
  const running = Object.values(state.running);
  if (running.length && running.every(Boolean)) return { label: "Running", color: "success" };
  if (running.some(Boolean)) return { label: "Partly running", color: "warning" };
  return { label: "Stopped", color: "error" };
}

function grafanaUrl(port: number, uid: string, vars: Record<string, string> = {}): string {
  const url = new URL(`http://${window.location.hostname}:${port}/d/${uid}/`);
  for (const [key, value] of Object.entries(vars)) url.searchParams.set(`var-${key}`, value);
  return url.toString();
}

function HealthTile({ label, up, expected }: { label: string; up: number; expected: number }) {
  const ok = expected === 0 ? up >= 0 : up >= expected;
  return (
    <Box sx={{ flex: "1 1 0", minWidth: 110, border: 1, borderRadius: 1.5, px: 1.5, py: 1,
      borderColor: expected && !ok ? "warning.main" : "divider" }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.3, color: expected && !ok ? "warning.main" : undefined }}>
        {up}{expected ? <Typography component="span" variant="body2" color="text.secondary"> / {expected}</Typography> : null}
      </Typography>
    </Box>
  );
}

/** Lab monitoring (the netlab `monitoring` plugin): turn it on, see the lab's health
 * against what the topology expects, open the Grafana dashboards. */
export function MonitoringDialog() {
  const request = useMonitoringDialogRequest();
  const sessionId = request?.sessionId ?? null;
  const [state, setState] = useState<MonitoringState | null>(null);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [node, setNode] = useState("");

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await api.getMonitoring(sessionId);
      setState(next);
      const live = Object.values(next.running).some(Boolean);
      setSummary(live ? await api.getMonitoringSummary(sessionId).catch(() => null) : null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [sessionId]);

  useEffect(() => {
    setState(null);
    setSummary(null);
    setError(null);
    void load();
    if (!sessionId) return undefined;
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load, sessionId]);

  const nodes = useMemo(() => (state?.coverage ?? []).map((item) => item.node), [state]);
  useEffect(() => {
    if (nodes.length && !nodes.includes(node)) setNode(nodes[0]);
  }, [nodes, node]);

  if (!request || !sessionId) return null;
  const close = () => openMonitoringDialog(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (on: boolean) => run(async () => setState(await api.setMonitoring(sessionId, on, state?.placement)));
  const place = (placement: "tool" | "node") => run(async () => setState(await api.setMonitoring(sessionId, true, placement)));
  const act = (action: "up" | "down") => run(async () => {
    const result = await api.monitoringAction(sessionId, action);
    if (result.code) setError(result.stderr || result.stdout);
    await load();
  });

  const status = state ? stackStatus(state) : null;
  const live = Boolean(state && Object.values(state.running).some(Boolean));
  const port = state?.grafanaPort ?? null;
  const dash = state?.dashboards ?? {};

  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Monitoring
        <Typography variant="body2" color="text.secondary">
          Metrics, protocol state and dashboards for this lab, for every device type. netlab starts it with the lab.
        </Typography>
        <IconButton aria-label="Close" onClick={close} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {error}
          </Alert>
        )}
        {!state && !error && <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>}
        {state && (
          <Stack spacing={2}>
            {!state.pluginAvailable && (
              <Alert severity="warning">This installation does not ship the monitoring plugin.</Alert>
            )}
            <Box sx={{ border: 1, borderColor: state.enabled ? "primary.main" : "divider", borderRadius: 1.5, p: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Tooltip title={state.enabled ? "Stop monitoring this lab" : "Monitor this lab"}>
                  <Switch checked={state.enabled} disabled={busy || !state.pluginAvailable}
                    onChange={(_event, on) => void toggle(on)}
                    slotProps={{ input: { "aria-label": "Monitor this lab" } }} />
                </Tooltip>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle2">Monitor this lab</Typography>
                    {status && <Chip size="small" color={status.color} variant={status.color === "default" ? "outlined" : "filled"} label={status.label} />}
                    {busy && <CircularProgress size={14} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    Adds <code>plugin: [ monitoring ]</code> to the topology — the same works from the netlab CLI.
                  </Typography>
                  {state.enabled && (
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                      <ToggleButtonGroup size="small" exclusive value={state.placement} disabled={busy}
                        onChange={(_event, value: "tool" | "node" | null) => { if (value) void place(value); }}>
                        <ToggleButton value="tool">Next to the lab</ToggleButton>
                        <ToggleButton value="node">As lab nodes</ToggleButton>
                      </ToggleButtonGroup>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
                        {state.placement === "node"
                          ? "The collector, metrics store and Grafana become lab nodes on the canvas and follow the lab's lifecycle."
                          : "Started by netlab up as an external tool on the lab host; nothing is added to the topology."}
                      </Typography>
                    </Stack>
                  )}
                  {state.enabled && state.labDeployed && state.rendered && state.placement === "tool" && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      {live
                        ? <Button size="small" variant="outlined" color="error" startIcon={<StopIcon />} disabled={busy} onClick={() => void act("down")}>Stop now</Button>
                        : <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} disabled={busy} onClick={() => void act("up")}>Start now</Button>}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </Box>

            {live && summary && (
              <Box>
                <Typography variant="overline" color="text.secondary">Health vs topology</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <HealthTile label="Nodes up" up={summary.nodesUp} expected={summary.nodes} />
                  <HealthTile label="BGP sessions" up={summary.bgpUp} expected={summary.bgpExpected} />
                  <HealthTile label="OSPF adjacencies" up={summary.ospfUp} expected={summary.ospfExpected} />
                  <HealthTile label="IS-IS adjacencies" up={summary.isisUp} expected={summary.isisExpected} />
                </Stack>
                {summary.missing.length > 0 ? (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>Defined in the topology but not up</Typography>
                    {summary.missing.slice(0, 12).map((item) => (
                      <Typography key={`${item.protocol}-${item.node}-${item.peer}-${item.detail}`} variant="body2">
                        {item.protocol}: {item.node} → {item.peer}{item.detail ? ` (${item.detail})` : ""}
                      </Typography>
                    ))}
                    {summary.missing.length > 12 && <Typography variant="body2">… and {summary.missing.length - 12} more</Typography>}
                  </Alert>
                ) : (
                  <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>Every session and adjacency the topology defines is up.</Typography>
                )}
              </Box>
            )}

            {live && port && (
              <Box>
                <Typography variant="overline" color="text.secondary">Dashboards</Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {dash.overview && <Button size="small" variant="contained" startIcon={<OpenInNewIcon />} href={grafanaUrl(port, dash.overview)} target="_blank" rel="noopener noreferrer">Lab overview</Button>}
                  {dash.routing && <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} href={grafanaUrl(port, dash.routing)} target="_blank" rel="noopener noreferrer">Routing & convergence</Button>}
                  {dash.node && nodes.length > 0 && (
                    <>
                      <TextField select size="small" value={node} onChange={(event) => setNode(event.target.value)} sx={{ minWidth: 120 }}
                        slotProps={{ htmlInput: { "aria-label": "Node" } }}>
                        {nodes.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
                      </TextField>
                      <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} href={grafanaUrl(port, dash.node, { node })} target="_blank" rel="noopener noreferrer">Node detail</Button>
                    </>
                  )}
                </Stack>
              </Box>
            )}

            {state.coverage.length > 0 && (
              <Box>
                <Divider sx={{ mb: 1 }} />
                <Typography variant="overline" color="text.secondary">What is collected</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "minmax(90px, max-content) minmax(90px, max-content) 1fr", columnGap: 2, rowGap: 0.5, alignItems: "center" }}>
                  {state.coverage.map((item) => (
                    <Box key={item.node} sx={{ display: "contents" }}>
                      <Typography variant="body2" sx={{ fontFamily: "monospace" }}>{item.node}</Typography>
                      <Typography variant="body2" color="text.secondary">{item.device}{item.provider && item.provider !== "clab" ? ` (${item.provider})` : ""}</Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {item.methods.length === 0 && <Chip size="small" variant="outlined" label="nothing" />}
                        {item.methods.map((method) => (
                          <Tooltip key={method} title={METHOD_HELP[method] ?? method}>
                            <Chip size="small" variant={method === "host" ? "outlined" : "filled"} color={method === "host" ? "default" : "primary"} label={method} />
                          </Tooltip>
                        ))}
                      </Stack>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            {state.enabled && state.coverage.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                netlab writes the collection plan (which node is collected how) when it creates the lab.
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
