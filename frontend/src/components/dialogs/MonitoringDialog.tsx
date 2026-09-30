import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";

import {
  api,
  type MonitoringState,
  type MonitoringSummary,
  type ScenarioRun
} from "../../api/client";
import { openMonitoringDialog, useMonitoringDialogRequest } from "../../host/monitoringDialogStore";

type TabId = "health" | "faults" | "setup";

const METHOD_HELP: Record<string, string> = {
  host: "CPU, memory and interface counters read on the lab host (any container or libvirt VM)",
  frr: "OSPF, IS-IS, BGP, BFD and routes from the FRR daemons' sockets (no network needed)",
  gnmi: "gNMI streaming telemetry (OpenConfig / SR Linux) over the management network",
  snmp: "SNMP interface counters over the management network"
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stackStatus(state: MonitoringState): {
  label: string;
  color: "success" | "warning" | "default" | "error";
} {
  if (!state.enabled)
    return { label: state.rendered ? "Off — stops on next deploy" : "Off", color: "default" };
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

function seconds(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "—" : `${value.toFixed(digits)} s`;
}

/** Recovery times come from device timestamps in whole seconds (FRR): 0 means under a second. */
function recovery(value: number | null | undefined): string {
  return value !== null && value !== undefined && value < 0.01 ? "< 1 s" : seconds(value);
}

function HealthTile({ label, up, expected }: { label: string; up: number; expected: number }) {
  const short = expected > 0 && up < expected;
  return (
    <Box
      sx={{
        flex: "1 1 0",
        minWidth: 100,
        borderRadius: 1,
        px: 1.5,
        py: 0.75,
        bgcolor: "action.hover",
        outline: short ? "1px solid" : "none",
        outlineColor: "warning.main"
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
      <Typography
        variant="h6"
        sx={{ lineHeight: 1.25, color: short ? "warning.main" : "text.primary" }}
      >
        {up}
        {expected > 0 && (
          <Typography component="span" variant="body2" color="text.secondary">
            {" "}
            / {expected}
          </Typography>
        )}
      </Typography>
    </Box>
  );
}

function HealthTab({
  state,
  summary,
  node,
  setNode
}: {
  state: MonitoringState;
  summary: MonitoringSummary | null;
  node: string;
  setNode: (node: string) => void;
}) {
  const port = state.grafanaPort ?? null;
  const dash = state.dashboards ?? {};
  const nodes = state.coverage.map((item) => item.node);
  return (
    <Stack spacing={2}>
      {summary ? (
        <>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <HealthTile label="Nodes up" up={summary.nodesUp} expected={summary.nodes} />
            <HealthTile label="BGP sessions" up={summary.bgpUp} expected={summary.bgpExpected} />
            <HealthTile
              label="OSPF adjacencies"
              up={summary.ospfUp}
              expected={summary.ospfExpected}
            />
            <HealthTile
              label="IS-IS adjacencies"
              up={summary.isisUp}
              expected={summary.isisExpected}
            />
          </Stack>
          {summary.missing.length > 0 ? (
            <Alert severity="warning" variant="outlined">
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Defined in the topology but not up
              </Typography>
              {summary.missing.slice(0, 10).map((item) => (
                <Typography
                  key={`${item.protocol}-${item.node}-${item.peer}-${item.detail}`}
                  variant="body2"
                >
                  {item.protocol} · {item.node} → {item.peer}
                  {item.detail ? ` (${item.detail})` : ""}
                </Typography>
              ))}
              {summary.missing.length > 10 && (
                <Typography variant="body2">… and {summary.missing.length - 10} more</Typography>
              )}
            </Alert>
          ) : (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <CheckCircleOutlineIcon fontSize="small" color="success" />
              <Typography variant="body2" color="text.secondary">
                Every session and adjacency the topology defines is up.
              </Typography>
            </Stack>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Health appears here while monitoring runs.
        </Typography>
      )}
      {port && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
            Grafana
          </Typography>
          {dash.overview && (
            <Button
              size="small"
              variant="outlined"
              endIcon={<OpenInNewIcon fontSize="small" />}
              href={grafanaUrl(port, dash.overview)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Lab
            </Button>
          )}
          {dash.routing && (
            <Button
              size="small"
              variant="outlined"
              endIcon={<OpenInNewIcon fontSize="small" />}
              href={grafanaUrl(port, dash.routing)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Routing
            </Button>
          )}
          {dash.node && nodes.length > 0 && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <TextField
                select
                size="small"
                value={node}
                onChange={(event) => setNode(event.target.value)}
                sx={{ minWidth: 110 }}
                slotProps={{ htmlInput: { "aria-label": "Node" } }}
              >
                {nodes.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                variant="outlined"
                endIcon={<OpenInNewIcon fontSize="small" />}
                href={grafanaUrl(port, dash.node, { node })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Node
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Stack>
  );
}

function ScenarioResults({ run }: { run: ScenarioRun }) {
  const cell = { py: 0.25, px: 1, fontSize: 13 } as const;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "auto auto auto auto 1fr",
        columnGap: 0,
        borderRadius: 1,
        overflow: "hidden",
        border: 1,
        borderColor: "divider"
      }}
    >
      {["Cycle", "Noticed after", "Down at worst", "Recovered after", ""].map((head) => (
        <Typography
          key={head || "x"}
          variant="caption"
          color="text.secondary"
          sx={{ ...cell, bgcolor: "action.hover" }}
        >
          {head}
        </Typography>
      ))}
      {run.results.map((cycle) => (
        <Box key={cycle.cycle} sx={{ display: "contents" }}>
          <Typography sx={cell}>{cycle.cycle}</Typography>
          <Typography sx={cell}>{seconds(cycle.reactionSeconds)}</Typography>
          <Typography sx={cell}>{cycle.impact}</Typography>
          <Typography
            sx={{
              ...cell,
              color: cycle.recoverySeconds === null && cycle.upAt ? "warning.main" : undefined
            }}
          >
            {cycle.upAt
              ? cycle.recoverySeconds === null
                ? "not recovered"
                : recovery(cycle.recoverySeconds)
              : "—"}
          </Typography>
          <Typography
            sx={{ ...cell, color: "text.secondary" }}
            noWrap
            title={cycle.affected.join("\n")}
          >
            {cycle.recoveryExact ? "device timestamps (1 s)" : cycle.upAt ? "sampled (0.5 s)" : ""}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function FaultsTab({
  sessionId,
  state,
  onError
}: {
  sessionId: string;
  state: MonitoringState;
  onError: (text: string) => void;
}) {
  const links = state.links ?? [];
  const [link, setLink] = useState(links[0]?.link ?? "");
  const [end, setEnd] = useState<"a" | "b" | "both">("a");
  const [cycles, setCycles] = useState(3);
  const [down, setDown] = useState(10);
  const [up, setUp] = useState(30);
  const [runs, setRuns] = useState<ScenarioRun[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRuns(await api.listScenarios(sessionId));
    } catch (err) {
      onError(errorText(err));
    }
  }, [sessionId, onError]);

  const running = runs.find((run) => run.status === "running");
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), running ? 1500 : 10000);
    return () => window.clearInterval(timer);
  }, [load, running]);
  useEffect(() => {
    if (!links.some((item) => item.link === link) && links[0]) setLink(links[0].link);
  }, [links, link]);

  const chosen = links.find((item) => item.link === link);
  const ends = chosen
    ? [
        ...(end !== "b" ? [{ node: chosen.a_node, ifname: chosen.a_ifname }] : []),
        ...(end !== "a" && chosen.b_node ? [{ node: chosen.b_node, ifname: chosen.b_ifname }] : [])
      ]
    : [];
  const start = async () => {
    setBusy(true);
    try {
      await api.startScenario({
        sessionId,
        links: ends,
        cycles,
        downSeconds: down,
        upSeconds: up,
        settleSeconds: Math.max(60, up * 2)
      });
      await load();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const latest = running ?? runs[0];
  const live = Object.values(state.running).some(Boolean);

  if (!live)
    return (
      <Typography variant="body2" color="text.secondary">
        Fault tests need monitoring running in a deployed lab.
      </Typography>
    );
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Take a link down and up on a schedule and measure how fast the lab notices and recovers —
        every cycle is marked on the Grafana dashboards and kept with the lab for comparison.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          select
          size="small"
          label="Link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          sx={{ minWidth: 150 }}
        >
          {links.map((item) => (
            <MenuItem key={item.link} value={item.link}>
              {item.link}
            </MenuItem>
          ))}
        </TextField>
        {chosen?.b_node && (
          <TextField
            select
            size="small"
            label="Take down"
            value={end}
            onChange={(event) => setEnd(event.target.value as "a" | "b" | "both")}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="a">
              {chosen.a_node} {chosen.a_ifname}
            </MenuItem>
            <MenuItem value="b">
              {chosen.b_node} {chosen.b_ifname}
            </MenuItem>
            <MenuItem value="both">both ends</MenuItem>
          </TextField>
        )}
        <TextField
          size="small"
          type="number"
          label="Cycles"
          value={cycles}
          onChange={(event) => setCycles(Number(event.target.value))}
          sx={{ width: 84 }}
          slotProps={{ htmlInput: { min: 1, max: 100 } }}
        />
        <TextField
          size="small"
          type="number"
          label="Down (s)"
          value={down}
          onChange={(event) => setDown(Number(event.target.value))}
          sx={{ width: 96 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
        <TextField
          size="small"
          type="number"
          label="Up (s)"
          value={up}
          onChange={(event) => setUp(Number(event.target.value))}
          sx={{ width: 90 }}
          slotProps={{ htmlInput: { min: 1 } }}
        />
        {running ? (
          <Button
            variant="outlined"
            color="error"
            startIcon={<StopIcon />}
            onClick={() => void api.cancelScenario(running.id).then(load)}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={busy || ends.length === 0}
            onClick={() => void start()}
          >
            Run
          </Button>
        )}
      </Stack>
      {latest && (
        <Box>
          <Stack
            direction="row"
            spacing={1}
            alignItems="baseline"
            sx={{ mb: 0.75 }}
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="subtitle2">
              {latest.links.map((item) => `${item.node} ${item.ifname}`).join(" + ")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {latest.cycles}× down {latest.downSeconds}s / up {latest.upSeconds}s ·{" "}
              {new Date(latest.startedAt * 1000).toLocaleString()}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              label={latest.status}
              color={
                latest.status === "done"
                  ? "success"
                  : latest.status === "running"
                    ? "primary"
                    : "warning"
              }
            />
          </Stack>
          {latest.status === "running" && (
            <Box sx={{ mb: 1 }}>
              <LinearProgress
                variant="determinate"
                value={(100 * Math.max(0, latest.results.length - 1)) / latest.cycles}
              />
              <Typography variant="caption" color="text.secondary">
                {latest.message}
              </Typography>
            </Box>
          )}
          {latest.status !== "running" && latest.message && latest.status !== "done" && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {latest.message}
            </Alert>
          )}
          {latest.results.length > 0 && <ScenarioResults run={latest} />}
          {latest.summary.recovery && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Recovery {recovery(latest.summary.recovery.min)} –{" "}
              {recovery(latest.summary.recovery.max)} (avg {recovery(latest.summary.recovery.avg)})
              {latest.summary.notRecovered > 0
                ? ` · ${latest.summary.notRecovered} not recovered`
                : ""}
            </Typography>
          )}
        </Box>
      )}
      {runs.length > 1 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            Earlier runs
          </Typography>
          {runs.slice(latest === runs[0] ? 1 : 0, 6).map((run) => (
            <Typography key={run.id} variant="body2" color="text.secondary">
              {new Date(run.startedAt * 1000).toLocaleString()} ·{" "}
              {run.links.map((item) => `${item.node} ${item.ifname}`).join(" + ")} · {run.cycles}× ·{" "}
              recovery avg {recovery(run.summary.recovery?.avg)} · {run.status}
            </Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
}

function SetupTab({
  state,
  busy,
  onPlace,
  onAction
}: {
  state: MonitoringState;
  busy: boolean;
  onPlace: (placement: "tool" | "node") => void;
  onAction: (action: "up" | "down") => void;
}) {
  const live = Object.values(state.running).some(Boolean);
  const groups = new Map<string, string[]>();
  for (const item of state.coverage) {
    const key = item.methods.join(" + ") || "nothing";
    groups.set(key, [...(groups.get(key) ?? []), item.node]);
  }
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Where the stack runs
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={state.placement}
          disabled={busy || !state.enabled}
          onChange={(_event, value: "tool" | "node" | null) => {
            if (value) onPlace(value);
          }}
        >
          <ToggleButton value="tool">Next to the lab</ToggleButton>
          <ToggleButton value="node">As lab nodes</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {state.placement === "node"
            ? "Collector, metrics store and Grafana are lab nodes: they get management addresses and start and stop with the lab."
            : "netlab up starts them as an external tool on the lab host; nothing is added to the topology."}
        </Typography>
        {state.enabled && state.labDeployed && state.rendered && state.placement === "tool" && (
          <Box sx={{ mt: 1 }}>
            {live ? (
              <Button
                size="small"
                color="error"
                startIcon={<StopIcon />}
                disabled={busy}
                onClick={() => onAction("down")}
              >
                Stop now
              </Button>
            ) : (
              <Button
                size="small"
                startIcon={<PlayArrowIcon />}
                disabled={busy}
                onClick={() => onAction("up")}
              >
                Start now
              </Button>
            )}
          </Box>
        )}
      </Box>
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          What is collected
        </Typography>
        {state.coverage.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            netlab writes the collection plan when it creates the lab.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {[...groups.entries()].map(([methods, nodes]) => (
              <Stack key={methods} direction="row" spacing={1} alignItems="center">
                <Stack direction="row" spacing={0.5} sx={{ minWidth: 110 }}>
                  {methods.split(" + ").map((method) => (
                    <Tooltip key={method} title={METHOD_HELP[method] ?? method}>
                      <Chip
                        size="small"
                        variant={method === "host" ? "outlined" : "filled"}
                        label={method}
                      />
                    </Tooltip>
                  ))}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                  {nodes.join(", ")}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        Same from the netlab CLI:{" "}
        <Box component="code" sx={{ px: 0.5, borderRadius: 0.5, bgcolor: "action.hover" }}>
          plugin: [ monitoring ]
        </Box>{" "}
        in the topology. The plugin lives in{" "}
        <Box component="code" sx={{ px: 0.5, borderRadius: 0.5, bgcolor: "action.hover" }}>
          {state.pluginPath}
        </Box>
        .
      </Typography>
    </Stack>
  );
}

/** Lab monitoring (the netlab `monitoring` plugin): health against the topology,
 * repeatable fault tests, Grafana dashboards and setup. */
export function MonitoringDialog() {
  const request = useMonitoringDialogRequest();
  const sessionId = request?.sessionId ?? null;
  const [state, setState] = useState<MonitoringState | null>(null);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("health");
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
    setTab("health");
    void load();
    if (!sessionId) return undefined;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load, sessionId]);

  const nodes = useMemo(() => (state?.coverage ?? []).map((item) => item.node), [state]);
  useEffect(() => {
    if (nodes.length && !nodes.includes(node)) setNode(nodes[0]);
  }, [nodes, node]);
  const showError = useCallback((text: string) => setError(text), []);

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
  const toggle = (on: boolean) =>
    run(async () => setState(await api.setMonitoring(sessionId, on, state?.placement)));
  const place = (placement: "tool" | "node") =>
    run(async () => setState(await api.setMonitoring(sessionId, true, placement)));
  const act = (action: "up" | "down") =>
    run(async () => {
      const result = await api.monitoringAction(sessionId, action);
      if (result.code) setError(result.stderr || result.stdout);
      await load();
    });
  const status = state ? stackStatus(state) : null;

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { minHeight: 480 } } }}
    >
      <DialogTitle sx={{ pr: 6, pb: 0 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography variant="h6" component="span">
            Monitoring
          </Typography>
          {status && (
            <Chip
              size="small"
              color={status.color}
              variant={status.color === "default" ? "outlined" : "filled"}
              label={status.label}
            />
          )}
          {busy && <CircularProgress size={14} />}
          <Box sx={{ flex: 1 }} />
          {state && (
            <Tooltip
              title={state.enabled ? "Stop monitoring this lab" : "Monitor this lab (every deploy)"}
            >
              <Stack direction="row" alignItems="center">
                <Typography variant="body2" color="text.secondary">
                  Monitor this lab
                </Typography>
                <Switch
                  checked={state.enabled}
                  disabled={busy || !state.pluginAvailable}
                  onChange={(_event, on) => void toggle(on)}
                  slotProps={{ input: { "aria-label": "Monitor this lab" } }}
                />
              </Stack>
            </Tooltip>
          )}
        </Stack>
        <IconButton
          aria-label="Close"
          onClick={close}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
        {state?.enabled && (
          <Tabs
            value={tab}
            onChange={(_event, value: TabId) => setTab(value)}
            sx={{ mt: 0.5, minHeight: 40, "& .MuiTab-root": { minHeight: 40 } }}
          >
            <Tab value="health" label="Health" />
            <Tab value="faults" label="Fault tests" />
            <Tab value="setup" label="Setup" />
          </Tabs>
        )}
      </DialogTitle>
      <DialogContent dividers={Boolean(state?.enabled)} sx={{ pt: 2 }}>
        {error && (
          <Alert
            severity="error"
            onClose={() => setError(null)}
            sx={{ mb: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {error}
          </Alert>
        )}
        {!state && !error && (
          <Stack alignItems="center" sx={{ py: 4 }}>
            <CircularProgress size={24} />
          </Stack>
        )}
        {state && !state.pluginAvailable && (
          <Alert severity="warning">This installation does not ship the monitoring plugin.</Alert>
        )}
        {state && state.pluginAvailable && !state.enabled && (
          <Stack spacing={1} sx={{ py: 2 }}>
            <Typography variant="body1">
              Metrics, routing-protocol state and dashboards for this lab — for every device type.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Switch it on and netlab starts a small collector, a metrics store and Grafana with the
              lab. You then see the lab's health against what the topology defines, run repeatable
              link-failure tests and measure convergence.
            </Typography>
          </Stack>
        )}
        {state?.enabled && tab === "health" && (
          <HealthTab state={state} summary={summary} node={node} setNode={setNode} />
        )}
        {state?.enabled && tab === "faults" && (
          <FaultsTab sessionId={sessionId} state={state} onError={showError} />
        )}
        {state?.enabled && tab === "setup" && (
          <SetupTab
            state={state}
            busy={busy}
            onPlace={(value) => void place(value)}
            onAction={(action) => void act(action)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
