import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  MenuList,
  Popover,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  createFilterOptions
} from "@mui/material";
import { openWebTab } from "../../host/webTabStore";
import { MonitoringOptions, type MonitoringOptionChange } from "./MonitoringOptions";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";

import {
  api,
  type MonitoringState,
  type MonitoringSummary,
  type FaultTests,
  type ScenarioRun,
  type ValidationCheck
} from "../../api/client";
import {
  type FaultTestPrefill,
  type MonitoringDialogRequest,
  notifyMonitoringChanged,
  openMonitoringDialog,
  useMonitoringDialogRequest
} from "../../host/monitoringDialogStore";

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

/** Grafana as a tab of this app; a plain browser tab when the user prefers that
 * (Settings → General) or the app cannot host one. */
function showGrafana(url: string, title: string): void {
  if (openWebTab({ url, title, subtitle: "Grafana" })) openMonitoringDialog(null);
  else window.open(url, "_blank", "noopener,noreferrer");
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

/** Re-renders every `ms`, for "updated 5 s ago". */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** Labs can have hundreds of nodes and links: pickers list the first matches and search the rest. */
const firstMatches = createFilterOptions<string>({ limit: 50 });

/** One menu for all dashboards: lab overview, routing, and a search for a node's detail. */
function DashboardMenu({ port, dash, nodes, live }: {
  port: number;
  dash: Record<string, string>;
  nodes: string[];
  live: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = (url: string, title: string) => {
    setAnchor(null);
    showGrafana(url, title);
  };
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={!live}
        startIcon={<ShowChartIcon fontSize="small" />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ textTransform: "none", alignSelf: "flex-start" }}
      >
        Open dashboard
      </Button>
      {/* A Popover, not a Menu: a Menu's type-to-select would steal the node search's keys. */}
      <Popover
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 280 } } }}
      >
        <MenuList dense>
          {dash.overview && <MenuItem onClick={() => open(grafanaUrl(port, dash.overview), "Lab overview")}>Lab overview</MenuItem>}
          {dash.routing && <MenuItem onClick={() => open(grafanaUrl(port, dash.routing), "Routing and convergence")}>Routing and convergence</MenuItem>}
        </MenuList>
        {dash.node && nodes.length > 0 && (
          <>
            <Divider />
            <Box sx={{ p: 1.5 }}>
              <Autocomplete
                size="small"
                options={nodes}
                filterOptions={firstMatches}
                onChange={(_event, name) => { if (name) open(grafanaUrl(port, dash.node, { node: name }), `Node detail: ${name}`); }}
                renderInput={(params) => <TextField {...params} label="Node detail" placeholder={`Find one of ${nodes.length} nodes`} />}
              />
            </Box>
          </>
        )}
      </Popover>
    </>
  );
}

function HealthTab({ state, summary, updatedAt }: {
  state: MonitoringState;
  summary: MonitoringSummary | null;
  /** When the numbers were last fetched (ms), or null before the first answer. */
  updatedAt: number | null;
}) {
  const now = useNow(5000);
  const port = state.grafanaPort ?? null;
  const dash = state.dashboards ?? {};
  const nodes = state.coverage.map((item) => item.node);
  // Grafana is part of the stack that starts with the lab: before a deploy there is nothing to open.
  const live = state.enabled && state.labDeployed && state.rendered && Object.values(state.running).some(Boolean);
  // A protocol the topology does not define has no tile: a 0 there reads as an outage.
  const protocols = summary
    ? [
        { label: "BGP sessions", up: summary.bgpUp, expected: summary.bgpExpected },
        { label: "OSPF adjacencies", up: summary.ospfUp, expected: summary.ospfExpected },
        { label: "IS-IS adjacencies", up: summary.isisUp, expected: summary.isisExpected },
        { label: "VXLAN VNIs", up: summary.vxlanUp, expected: summary.vxlanExpected }
      ].filter((item) => item.expected > 0)
    : [];
  return (
    <Stack spacing={2}>
      {summary ? (
        <>
          {/* What is down comes first: it's the reason to look. */}
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
                  {item.protocol} · {item.node}{item.peer ? ` → ${item.peer}` : ""}
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
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <HealthTile label="Nodes up" up={summary.nodesUp} expected={summary.nodes} />
            {protocols.map((item) => (
              <HealthTile key={item.label} label={item.label} up={item.up} expected={item.expected} />
            ))}
          </Stack>
          {updatedAt !== null && (
            <Typography variant="caption" color="text.secondary">
              Updated {ago(updatedAt, now)} · refreshes every 10 s
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Health appears here while monitoring runs.
        </Typography>
      )}
      {port && (dash.overview || dash.routing || dash.node) && (
        <Stack spacing={0.5}>
          <DashboardMenu port={port} dash={dash} nodes={nodes} live={live} />
          {!live && (
            <Typography variant="caption" color="text.secondary">
              Grafana runs with the lab: deploy it to open the dashboards.
            </Typography>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** The run's outcome, coloured explicitly (the app theme flattens Chip colours). */
function VerdictChip({ value, title }: { value: string; title?: string }) {
  const tone =
    value === "passed" || value === "done"
      ? "success.main"
      : value === "failed"
        ? "error.main"
        : value === "running"
          ? "primary.main"
          : "warning.main";
  return (
    <Chip
      size="small"
      variant="outlined"
      label={value}
      title={title}
      sx={{ color: tone, borderColor: tone, fontWeight: 600 }}
    />
  );
}

/** passed/failed for a finished run with a verdict, else its status (running, cancelled, …). */
function verdictOf(run: ScenarioRun): string {
  const result = run.summary.verdict?.result;
  return run.status === "done" && result ? result : run.status;
}

/** "2/2 passed" for a cycle's netlab validate results, with every test in the tooltip. */
function checksText(checks: ValidationCheck[]): { text: string; failed: boolean; detail: string } {
  const failed = checks.filter((check) => check.passed === false);
  const detail = checks
    .map((check) => {
      const status = check.passed === false ? "FAIL" : check.passed ? "pass" : "—";
      const time =
        check.passed && check.seconds !== null && check.seconds !== undefined
          ? ` in ${check.seconds} s`
          : "";
      return `${status} ${check.test}${time}${check.message ? `: ${check.message}` : ""}`;
    })
    .join("\n");
  const text = failed.length
    ? `${failed.length} of ${checks.length} failed`
    : `${checks.length}/${checks.length} passed`;
  return { text, failed: failed.length > 0, detail };
}

function ValidateCell({
  during,
  after,
  cell
}: {
  during: ValidationCheck[];
  after: ValidationCheck[];
  cell: Record<string, unknown>;
}) {
  const down = during.length ? checksText(during) : null;
  const up = after.length ? checksText(after) : null;
  return (
    <Typography
      sx={{ ...cell, color: up?.failed ? "error.main" : "text.secondary" }}
      noWrap
      title={[down && `While down:\n${down.detail}`, up && `After recovery:\n${up.detail}`]
        .filter(Boolean)
        .join("\n\n")}
    >
      {up ? `after: ${up.text}` : ""}
      {up && down ? " · " : ""}
      {down ? `while down: ${down.text}` : ""}
    </Typography>
  );
}

function ScenarioResults({ run }: { run: ScenarioRun }) {
  const cell = { py: 0.25, px: 1, fontSize: 13 } as const;
  const validated = run.results.some(
    (cycle) => (cycle.after ?? []).length || (cycle.during ?? []).length
  );
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
      {[
        "Cycle",
        "Noticed after",
        "Down at worst",
        "Recovered after",
        validated ? "netlab validate" : ""
      ].map((head) => (
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
          {validated ? (
            <ValidateCell during={cycle.during ?? []} after={cycle.after ?? []} cell={cell} />
          ) : (
            <Typography
              sx={{ ...cell, color: "text.secondary" }}
              noWrap
              title={cycle.affected.join("\n")}
            >
              {cycle.recoveryExact
                ? "device timestamps (1 s)"
                : cycle.upAt
                  ? "sampled (0.5 s)"
                  : ""}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

function FaultsTab({
  sessionId,
  state,
  prefill,
  onError
}: {
  sessionId: string;
  state: MonitoringState;
  prefill?: FaultTestPrefill;
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
  const [defined, setDefined] = useState<FaultTests>({ faults: [], validationTests: [] });
  const [validate, setValidate] = useState(false);
  useEffect(() => {
    void api.listFaultTests(sessionId).then(setDefined, () => undefined);
  }, [sessionId]);
  // Filled in by an AI agent: highlight Run until the user starts it
  const [suggested, setSuggested] = useState(false);
  useEffect(() => {
    if (!prefill) return;
    setLink(prefill.link);
    setEnd(prefill.end);
    setCycles(prefill.cycles);
    setDown(prefill.down);
    setUp(prefill.up);
    setSuggested(true);
  }, [prefill]);

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
    setSuggested(false);
    try {
      await api.startScenario({
        sessionId,
        links: ends,
        cycles,
        downSeconds: down,
        upSeconds: up,
        settleSeconds: Math.max(60, up * 2),
        validateAfter: validate ? [] : null
      });
      await load();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const runNamed = async (name: string) => {
    setBusy(true);
    try {
      await api.startScenario({ sessionId, name });
      await load();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const latest = running ?? runs[0];
  const live = Object.values(state.running).some(Boolean);
  const lastVerdict = (name: string) =>
    runs.find((run) => run.name === name && run.status !== "running");

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
      {defined.faults.length > 0 && (
        <Box>
          <Typography variant="overline" color="text.secondary">
            This lab's fault tests
          </Typography>
          <Stack spacing={0.75}>
            {defined.faults.map((fault) => {
              const last = lastVerdict(fault.name);
              const verdict = last?.summary.verdict?.result;
              return (
                <Stack
                  key={fault.name}
                  direction="row"
                  spacing={1.5}
                  alignItems="center"
                  sx={{ px: 1.25, py: 0.75, border: 1, borderColor: "divider", borderRadius: 1 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {fault.name}
                      {fault.description && (
                        <Typography component="span" variant="body2" color="text.secondary">
                          {" "}
                          — {fault.description}
                        </Typography>
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fault.links.join(", ")} · {fault.cycles}× down {fault.down}s / up {fault.up}s
                      {fault.validateAfter
                        ? ` · validate ${fault.validateAfter.length ? fault.validateAfter.join(", ") : "all"}`
                        : ""}
                      {fault.expectRecovery !== null && fault.expectRecovery !== undefined
                        ? ` · recovery ≤ ${fault.expectRecovery} s`
                        : ""}
                    </Typography>
                  </Box>
                  {verdict && (verdict === "passed" || verdict === "failed") && (
                    <VerdictChip
                      value={verdict}
                      title={`Last run ${new Date(last.startedAt * 1000).toLocaleString()}`}
                    />
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PlayArrowIcon />}
                    disabled={busy || Boolean(running)}
                    onClick={() => void runNamed(fault.name)}
                  >
                    Run
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        </Box>
      )}
      <Typography variant="overline" color="text.secondary" sx={{ mb: -1.5 }}>
        {defined.faults.length > 0 ? "Quick test" : "Test a link"}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Autocomplete
          size="small"
          options={links.map((item) => item.link)}
          value={link || null}
          onChange={(_event, value) => setLink(value ?? "")}
          filterOptions={firstMatches}
          disableClearable={Boolean(link)}
          sx={{ minWidth: 220, flex: "1 1 220px" }}
          renderInput={(params) => <TextField {...params} label="Link" placeholder="Type to find a link" />}
        />
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
            sx={
              suggested
                ? { outline: 3, outlineColor: "primary.light", outlineOffset: 2 }
                : undefined
            }
          >
            Run
          </Button>
        )}
      </Stack>
      {defined.validationTests.length > 0 && (
        <FormControlLabel
          sx={{ mt: -1 }}
          control={
            <Checkbox
              size="small"
              checked={validate}
              onChange={(event) => setValidate(event.target.checked)}
            />
          }
          label={
            <Typography variant="body2" color="text.secondary">
              Run the lab's netlab validate tests after each recovery (
              {defined.validationTests.length})
            </Typography>
          }
        />
      )}
      {defined.faults.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
          Tip: write repeatable fault tests into the topology (<code>monitoring.faults</code>), with
          netlab validate checks and a pass/fail limit — they show up here with a Run button.
        </Typography>
      )}
      {suggested && !running && (
        <Typography variant="caption" color="primary">
          Set up by your AI agent — check the link and timing, then press Run.
        </Typography>
      )}
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
              {latest.name ? `${latest.name} · ` : ""}
              {latest.links.map((item) => `${item.node} ${item.ifname}`).join(" + ")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {latest.cycles}× down {latest.downSeconds}s / up {latest.upSeconds}s ·{" "}
              {new Date(latest.startedAt * 1000).toLocaleString()}
            </Typography>
            <VerdictChip value={verdictOf(latest)} />
          </Stack>
          {(latest.summary.verdict?.reasons ?? []).length > 0 && (
            <Alert severity="error" variant="outlined" sx={{ mb: 1, py: 0 }}>
              {(latest.summary.verdict?.reasons ?? []).map((reason) => (
                <Typography key={reason} variant="body2">
                  {reason}
                </Typography>
              ))}
            </Alert>
          )}
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
              {latest.summary.recovery.min === latest.summary.recovery.max
                ? `Recovery ${recovery(latest.summary.recovery.min)}`
                : `Recovery ${recovery(latest.summary.recovery.min)} – ${recovery(latest.summary.recovery.max)} ` +
                  `(avg ${recovery(latest.summary.recovery.avg)})`}
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
              {new Date(run.startedAt * 1000).toLocaleString()} · {run.name ? `${run.name} · ` : ""}
              {run.links.map((item) => `${item.node} ${item.ifname}`).join(" + ")} · {run.cycles}× ·{" "}
              recovery avg {recovery(run.summary.recovery?.avg)} · {verdictOf(run)}
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
  onAction,
  onOptions
}: {
  state: MonitoringState;
  busy: boolean;
  onPlace: (placement: "tool" | "node") => void;
  onAction: (action: "up" | "down") => void;
  onOptions: (change: MonitoringOptionChange) => void;
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
      <MonitoringOptions state={state} busy={busy} onChange={onOptions} />
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
/** Everything the Monitoring dialog and the Monitoring side-panel tab share. */
function useMonitoringController(sessionId: string | null, request: MonitoringDialogRequest | null) {
  const [state, setState] = useState<MonitoringState | null>(null);
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("health");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await api.getMonitoring(sessionId);
      setState(next);
      const live = Object.values(next.running).some(Boolean);
      setSummary(live ? await api.getMonitoringSummary(sessionId).catch(() => null) : null);
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(errorText(err));
    }
  }, [sessionId]);

  useEffect(() => {
    setState(null);
    setSummary(null);
    setUpdatedAt(null);
    setError(null);
    setTab("health");
    void load();
    if (!sessionId) return undefined;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load, sessionId]);

  // Opened on a tab (e.g. by an AI agent showing the user around)
  useEffect(() => {
    if (request?.tab) setTab(request.tab);
  }, [request]);

  const showError = useCallback((text: string) => setError(text), []);

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
    run(async () => {
      setState(await api.setMonitoring(sessionId!, on, state?.placement));
      notifyMonitoringChanged();
    });
  const place = (placement: "tool" | "node") =>
    run(async () => setState(await api.setMonitoring(sessionId!, true, placement)));
  const options = (change: MonitoringOptionChange) =>
    run(async () => setState(await api.setMonitoring(sessionId!, true, state?.placement, change)));
  const act = (action: "up" | "down") =>
    run(async () => {
      const result = await api.monitoringAction(sessionId!, action);
      if (result.code) setError(result.stderr || result.stdout);
      await load();
    });
  const status = state ? stackStatus(state) : null;

  return { state, summary, busy, error, setError, tab, setTab, updatedAt, showError, toggle, place, options, act, status, request };
}

export function MonitoringDialog() {
  const request = useMonitoringDialogRequest();
  const sessionId = request?.sessionId ?? null;
  const c = useMonitoringController(sessionId, request);
  if (!request || !sessionId) return null;
  const { state, summary, busy, error, setError, tab, setTab, updatedAt, showError, toggle, place, options, act, status } = c;
  const close = () => openMonitoringDialog(null);

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
          <HealthTab state={state} summary={summary} updatedAt={updatedAt} />
        )}
        {state?.enabled && tab === "faults" && (
          <FaultsTab
            sessionId={sessionId}
            state={state}
            prefill={request.faultTest}
            onError={showError}
          />
        )}
        {state?.enabled && tab === "setup" && (
          <SetupTab
            state={state}
            busy={busy}
            onPlace={(value) => void place(value)}
            onAction={(action) => void act(action)}
            onOptions={(change) => void options(change)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}


/** The same controls as the dialog, docked as a tab of the right-hand panel. */
export function MonitoringPanel({ sessionId }: { sessionId: string }) {
  const c = useMonitoringController(sessionId, null);
  const { state, summary, busy, error, setError, tab, setTab, updatedAt, showError, toggle, place, options, act, status } = c;
  return (
    <Box sx={{ p: 1.5, overflow: "auto", height: "100%" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1">Monitoring</Typography>
        {status && <Chip size="small" color={status.color} variant={status.color === "default" ? "outlined" : "filled"} label={status.label} />}
        {busy && <CircularProgress size={14} />}
        <Box sx={{ flex: 1 }} />
        {state && (
          <Tooltip title={state.enabled ? "Stop monitoring this lab" : "Monitor this lab (every deploy)"}>
            <FormControlLabel
              labelPlacement="start"
              label={<Typography variant="body2" color="text.secondary">Monitor this lab</Typography>}
              sx={{ mr: 0 }}
              control={
                <Switch
                  size="small"
                  checked={state.enabled}
                  disabled={busy || !state.pluginAvailable}
                  onChange={(_event, on) => void toggle(on)}
                />
              }
            />
          </Tooltip>
        )}
      </Stack>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error}
        </Alert>
      )}
      {!state && !error && (
        <Stack alignItems="center" sx={{ py: 3 }}>
          <CircularProgress size={22} />
        </Stack>
      )}
      {state?.enabled && (
        <>
          <Tabs value={tab} onChange={(_event, value: TabId) => setTab(value)} variant="fullWidth" sx={{ minHeight: 36, mb: 1.5, "& .MuiTab-root": { minHeight: 36 } }}>
            <Tab value="health" label="Health" />
            <Tab value="faults" label="Fault tests" />
            <Tab value="setup" label="Setup" />
          </Tabs>
          {tab === "health" && <HealthTab state={state} summary={summary} updatedAt={updatedAt} />}
          {tab === "faults" && <FaultsTab sessionId={sessionId} state={state} prefill={undefined} onError={showError} />}
          {tab === "setup" && (
            <SetupTab
              state={state}
              busy={busy}
              onPlace={(value) => void place(value)}
              onAction={(action) => void act(action)}
              onOptions={(change) => void options(change)}
            />
          )}
        </>
      )}
    </Box>
  );
}
