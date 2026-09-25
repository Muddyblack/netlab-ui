import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  IconButton, ListItemText, Menu, MenuItem, Switch, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { useNodes } from "@containerlab/clab-ui";

import { api, type ExecMode, type ExecScript, type ExecTargets } from "../../api/client";
import { suggestCommands } from "./suggestions";
import { downloadText, scriptFromRuns, transcriptMarkdown, type ExecRun } from "./model";
import { RunResults } from "./RunResults";

const HISTORY_KEY = "netlab.multiExec.history";
const MAX_HISTORY = 50;

const GROUP_HEADINGS = { all: "", group: "Groups", node: "Nodes" } as const;

interface TargetOption { value: string; label: string; kind: "all" | "group" | "node"; running?: boolean }

function loadHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function targetOptions(targets: ExecTargets | null): TargetOption[] {
  if (!targets) return [{ value: "all", label: "all nodes", kind: "all" }];
  const running = targets.nodes.filter((node) => node.running).length;
  return [
    { value: "all", label: `all nodes (${running}/${targets.nodes.length} running)`, kind: "all" },
    ...Object.keys(targets.groups).map((name) => ({ value: name, label: `group ${name}`, kind: "group" as const })),
    ...targets.nodes.map((node) => ({ value: node.name, label: node.device ? `${node.name} · ${node.device}` : node.name, kind: "node" as const, running: node.running })),
  ];
}

function SaveScriptDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Save commands as a script</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Every command in this session, in order, with the nodes it ran on. Scripts are stored next to the topology,
          so they travel with the lab.
        </Typography>
        <TextField autoFocus fullWidth size="small" label="Script name" value={name} onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) onSave(name.trim()); }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function ScriptsMenu({ anchorEl, scripts, onClose, onReplay, onDelete }: {
  anchorEl: HTMLElement | null;
  scripts: ExecScript[];
  onClose: () => void;
  onReplay: (script: ExecScript) => void;
  onDelete: (script: ExecScript) => void;
}) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
      {scripts.length === 0 && <MenuItem disabled>No saved scripts yet — run some commands, then “Save session as script”</MenuItem>}
      {scripts.map((script) => (
        <MenuItem key={script.name} onClick={() => { onReplay(script); onClose(); }}>
          <ListItemText primary={`Replay "${script.name}"`} secondary={`${script.steps?.length ?? 0} commands`} />
          <IconButton size="small" edge="end" aria-label={`Delete script ${script.name}`} sx={{ ml: 2 }}
            onClick={(event) => { event.stopPropagation(); onDelete(script); }}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Session-dock tab: send one command to many nodes and compare the answers
 * side by side. The session log can be saved as a script and replayed later,
 * or exported as a Markdown transcript. */
export function MultiExecPanel({ sessionId }: { sessionId: string }) {
  const [targets, setTargets] = useState<ExecTargets | null>(null);
  const [selection, setSelection] = useState<string[]>(["all"]);
  const [mode, setMode] = useState<ExecMode>("auto");
  const [modules, setModules] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const commandRef = useRef<HTMLInputElement | null>(null);
  const canvasNodes = useNodes();
  const [command, setCommand] = useState("");
  const [runs, setRuns] = useState<ExecRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [scripts, setScripts] = useState<ExecScript[]>([]);
  const [scriptsAnchor, setScriptsAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const historyIndex = useRef(-1);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getExecTargets(sessionId).then((value) => { if (!cancelled) setTargets(value); }).catch(() => undefined);
    void api.getExecScripts(sessionId).then((value) => { if (!cancelled) setScripts(value.scripts); }).catch(() => undefined);
    return () => { cancelled = true; abortRef.current?.abort(); };
  }, [sessionId]);

  // Nodes selected on the canvas are what the user means; otherwise every
  // running node. Only on open — after that the picker is theirs.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current) return;
    preselected.current = true;
    const picked = canvasNodes.filter((node) => node.selected).map((node) => node.id);
    if (picked.length) setSelection(picked);
    commandRef.current?.focus();
  }, [canvasNodes]);

  useEffect(() => {
    let cancelled = false;
    void api.searchLab(sessionId, "module:").then((result) => {
      if (!cancelled) setModules(result.modules.map((module) => module.title));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [runs]);

  const options = useMemo(() => targetOptions(targets), [targets]);

  const execute = useCallback(async (step: { command: string; mode: ExecMode; selection: string[] }, signal: AbortSignal) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const update = (patch: (run: ExecRun) => ExecRun) => setRuns((current) => current.map((run) => (run.id === id ? patch(run) : run)));
    setRuns((current) => [...current, { id, ...step, targets: [], results: {}, startedAt: Date.now(), done: false }]);
    try {
      await api.execOnNodes(
        { sessionId, nodes: step.selection, command: step.command, mode: step.mode },
        {
          onTargets: (nodes) => update((run) => ({ ...run, targets: nodes })),
          onResult: (result) => update((run) => ({ ...run, results: { ...run.results, [result.node]: result } })),
        },
        signal,
      );
      update((run) => ({ ...run, done: true }));
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const message = err instanceof Error ? err.message : String(err);
      update((run) => ({ ...run, done: true, error: aborted ? "stopped" : message }));
    }
  }, [sessionId]);

  const runSteps = useCallback(async (steps: Array<{ command: string; mode: ExecMode; selection: string[] }>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      for (const step of steps) {
        if (controller.signal.aborted) break;
        await execute(step, controller.signal);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [execute]);

  const submit = (override?: string) => {
    const text = (override ?? command).trim();
    if (!text || busy || selection.length === 0) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify([text, ...loadHistory().filter((item) => item !== text)].slice(0, MAX_HISTORY)));
    } catch { /* history is a convenience */ }
    setHistory(loadHistory());
    historyIndex.current = -1;
    setCommand("");
    void runSteps([{ command: text, mode, selection }]);
  };

  const onCommandKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") { event.preventDefault(); submit(); return; }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const history = loadHistory();
    if (history.length === 0) return;
    event.preventDefault();
    const next = event.key === "ArrowUp"
      ? Math.min(history.length - 1, historyIndex.current + 1)
      : Math.max(-1, historyIndex.current - 1);
    historyIndex.current = next;
    setCommand(next < 0 ? "" : history[next]);
  };

  const persistScripts = async (next: ExecScript[]) => {
    try {
      setScripts((await api.saveExecScripts(sessionId, next)).scripts);
    } catch (err) {
      setNotice(`Could not save scripts: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveScript = (name: string) => {
    setSaveOpen(false);
    const script = scriptFromRuns(name, runs.filter((run) => !run.error));
    void persistScripts([...scripts.filter((item) => item.name !== name), script]);
    setNotice(`Saved "${name}" (${script.steps?.length ?? 0} commands).`);
  };

  const replay = (script: ExecScript) => {
    setNotice(`Replaying "${script.name}"…`);
    void runSteps((script.steps ?? []).map((step) => ({
      command: step.command,
      mode: step.mode ?? "shell",
      selection: step.nodes && step.nodes.length > 0 ? step.nodes : selection,
    })));
  };

  const selected = options.filter((option) => selection.includes(option.value));
  const quickCommands = useMemo(() => {
    const nodes = targets?.nodes ?? [];
    const chosen = selection.includes("all")
      ? nodes.filter((node) => node.running)
      : nodes.filter((node) => selection.includes(node.name) || Object.entries(targets?.groups ?? {}).some(([group, members]) => selection.includes(group) && members.includes(node.name)));
    const devices = [...new Set(chosen.map((node) => node.device ?? ""))];
    return [...new Set([...history.slice(0, 3), ...suggestCommands(devices, modules)])].slice(0, 8);
  }, [targets, selection, modules, history]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.default" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.75, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}>
        <Autocomplete
          multiple
          size="small"
          options={options}
          value={selected}
          onChange={(_event, value) => setSelection(value.map((option) => option.value))}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          groupBy={(option) => GROUP_HEADINGS[option.kind]}
          renderOption={(props, option) => (
            <li {...props} key={option.value}>
              <Typography variant="body2" sx={{ fontFamily: option.kind === "node" ? "monospace" : undefined, opacity: option.kind === "node" && !option.running ? 0.55 : 1 }}>
                {option.label}{option.kind === "node" && !option.running ? " (not running)" : ""}
              </Typography>
            </li>
          )}
          renderTags={(value, getTagProps) => value.map((option, index) => (
            <Chip {...getTagProps({ index })} key={option.value} size="small" label={option.kind === "group" ? `@${option.value}` : option.value} />
          ))}
          renderInput={(params) => <TextField {...params} label="Run on" placeholder={selection.length ? "" : "nodes or groups"} />}
          sx={{ minWidth: 170, flex: "1 1 200px", maxWidth: 420 }}
        />
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, value: ExecMode | null) => value && setMode(value)}>
          <Tooltip title="“show …” goes to each device's CLI, anything else to its shell"><ToggleButton value="auto">Auto</ToggleButton></Tooltip>
          <Tooltip title="Linux shell command in the node (netlab exec) — pipes work"><ToggleButton value="shell">Shell</ToggleButton></Tooltip>
          <Tooltip title="Device CLI show command (netlab connect --show) — vtysh, Cli, sr_cli…"><ToggleButton value="show">Show</ToggleButton></Tooltip>
        </ToggleButtonGroup>
        <TextField
          size="small"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={onCommandKey}
          inputRef={commandRef}
          placeholder={mode === "shell" ? "ip route | head" : "show ip route"}
          title="Enter runs it · ↑/↓ browse history"
          inputProps={{ "aria-label": "Command", style: { fontFamily: "monospace" } }}
          sx={{ flex: "3 1 160px", minWidth: 140 }}
        />
        {busy ? (
          <Button size="small" color="warning" variant="outlined" startIcon={<StopIcon />} onClick={() => abortRef.current?.abort()}>Stop</Button>
        ) : (
          <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} disabled={!command.trim() || selection.length === 0} onClick={() => submit()}>Run</Button>
        )}
        <Tooltip title="Saved scripts">
          <IconButton size="small" aria-label="Saved scripts" onClick={(event) => setScriptsAnchor(event.currentTarget)} disabled={busy}>
            <PlaylistPlayIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" aria-label="More session actions" onClick={(event) => setMoreAnchor(event.currentTarget)}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Box>

      {quickCommands.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", overflowX: "auto" }}>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, mr: 0.5 }}>Quick:</Typography>
          {quickCommands.map((text) => (
            <Tooltip key={text} describeChild title={`Run on ${selection.join(", ") || "…"} · Shift-click to edit first`}>
              <Chip
                size="small"
                variant="outlined"
                label={text}
                disabled={busy || selection.length === 0}
                onClick={(event) => {
                  if (event.shiftKey) { setCommand(text); commandRef.current?.focus(); return; }
                  submit(text);
                }}
                sx={{ fontFamily: "monospace", fontSize: "0.72rem", flexShrink: 0 }}
              />
            </Tooltip>
          ))}
        </Box>
      )}

      <ScriptsMenu
        anchorEl={scriptsAnchor}
        scripts={scripts}
        onClose={() => setScriptsAnchor(null)}
        onReplay={replay}
        onDelete={(script) => void persistScripts(scripts.filter((item) => item.name !== script.name))}
      />
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={() => setMoreAnchor(null)}>
        <MenuItem disabled={runs.length === 0} onClick={() => { setSaveOpen(true); setMoreAnchor(null); }}>Save session as script…</MenuItem>
        <MenuItem disabled={runs.length === 0} onClick={() => { downloadText("netlab-commands.md", transcriptMarkdown("netlab lab", runs)); setMoreAnchor(null); }}>
          Export transcript (Markdown)
        </MenuItem>
        <MenuItem disabled={runs.length === 0 || busy} onClick={() => { setRuns([]); setMoreAnchor(null); }}>Clear session</MenuItem>
        <Divider />
        <MenuItem onClick={() => setGrouped((value) => !value)}>
          <FormControlLabel control={<Switch size="small" checked={grouped} />} label="Merge identical outputs" sx={{ pointerEvents: "none" }} />
        </MenuItem>
      </Menu>
      <SaveScriptDialog open={saveOpen} onClose={() => setSaveOpen(false)} onSave={saveScript} />

      {notice && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pt: 0.5 }} onClick={() => setNotice(null)}>{notice}</Typography>
      )}
      <Box ref={logRef} sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
        {runs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Pick nodes or groups, type a command and press Enter — every node answers side by side, identical answers
            are merged. Shell runs a Linux command in the node; Show runs a CLI show command in the device’s own shell.
          </Typography>
        ) : runs.map((run) => (
          <RunResults key={run.id} run={run} grouped={grouped}
            onRerun={(previous) => void runSteps([{ command: previous.command, mode: previous.mode, selection: previous.selection }])} />
        ))}
      </Box>
    </Box>
  );
}
