import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, Collapse, Link, Stack, TextField, Tooltip, Typography } from "@mui/material";

import { SetupSection } from "./SetupSection";

import { api, type MonitoringScope, type MonitoringScopeNode, type MonitoringSelection } from "../../api/client";

/** How many node chips to list before "+N more": a lab can have hundreds of nodes. */
const CHIP_LIMIT = 80;
const PREVIEW_DELAY_MS = 400;

type Draft = { nodes: string; light: string; seed: string };

/** Ready-made selections; each sets what it names and leaves the rest of the draft alone. */
const PRESETS: { label: string; tip: string; set: Partial<Draft> }[] = [
  { label: "All nodes", tip: "Monitor every node in full", set: { nodes: "", light: "" } },
  { label: "First 10 / group", tip: "group:* | first 10", set: { nodes: "group:* | first 10" } },
  { label: "10 random nodes", tip: "* | random 10 (the same ones every time; change the seed for others)", set: { nodes: "* | random 10" } },
  { label: "Routers only", tip: "role=router", set: { nodes: "role=router" } },
  { label: "Host only", tip: "Every monitored node gets just CPU, memory and interface counters: the cheapest", set: { light: "*" } }
];

const STATE_TEXT = { full: "monitored", host: "host metrics only", off: "not monitored" } as const;
const STATE_COLOR = { full: "primary", host: "info", off: "default" } as const;
const NEXT_STATE = { full: "host", host: "off", off: "full" } as const;
const MONO = { spellCheck: false, style: { fontFamily: "monospace" } };

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const toDraft = (scope: MonitoringScope): Draft => ({
  nodes: scope.nodes.join("\n"),
  light: scope.light.join("\n"),
  seed: scope.seed ? String(scope.seed) : ""
});

const toSelection = (draft: Draft): MonitoringSelection => ({
  nodes: lines(draft.nodes),
  light: lines(draft.light),
  seed: Math.max(0, Number.parseInt(draft.seed, 10) || 0)
});

/** The backend answers errors as {"detail": "..."}: show the sentence, not the JSON around it. */
function problemText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const start = text.indexOf("{");
  if (start < 0) return text;
  try {
    const detail = (JSON.parse(text.slice(start)) as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : text;
  } catch {
    return text;
  }
}

function summary(scope: MonitoringScope): string {
  const base = `${scope.monitored} of ${scope.total} nodes`;
  return scope.host > 0 ? `${base} (${scope.host} host-only)` : base;
}


function Messages({ problem, shown, notes }: { problem: string | null; shown: MonitoringScope | null; notes: string[] }) {
  const items = [
    ...(problem ? [{ severity: "error" as const, text: problem }] : []),
    ...(shown?.errors ?? []).map((text) => ({ severity: "error" as const, text })),
    ...(shown?.warnings ?? []).map((text) => ({ severity: "warning" as const, text })),
    ...notes.map((text) => ({ severity: "success" as const, text }))
  ];
  if (items.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {items.map((item) => (
        <Alert key={item.text} severity={item.severity} sx={{ py: 0 }}>{item.text}</Alert>
      ))}
    </Stack>
  );
}

/** The editor's state: the saved selection, the draft being typed, a preview of what the draft matches, and saving. */
function useScopeEditor(sessionId: string, enabled: boolean, onChanged: () => void) {
  const [saved, setSaved] = useState<MonitoringScope | null>(null);
  const [preview, setPreview] = useState<MonitoringScope | null>(null);
  const [draft, setDraft] = useState<Draft>({ nodes: "", light: "", seed: "" });
  const [working, setWorking] = useState<"load" | "save" | null>("load");
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const latest = useRef(0);

  const selection = useMemo(() => toSelection(draft), [draft]);
  const dirty = useMemo(
    () => saved !== null && JSON.stringify(selection) !== JSON.stringify(toSelection(toDraft(saved))),
    [saved, selection]
  );
  const edit = useCallback((change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change })), []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    setWorking("load");
    setProblem(null);
    api
      .getMonitoringScope(sessionId)
      .then((scope) => {
        if (!current) return;
        setSaved(scope);
        setPreview(scope);
        setDraft(toDraft(scope));
      })
      .catch((err) => current && setProblem(problemText(err)))
      .finally(() => current && setWorking(null));
    return () => {
      current = false;
    };
  }, [sessionId, enabled]);

  // Preview what an edited selection matches, shortly after the typing stops. An older answer never replaces a newer one.
  useEffect(() => {
    if (!saved) return;
    if (!dirty) {
      setPreview(saved);
      return;
    }
    const ticket = ++latest.current;
    const timer = window.setTimeout(() => {
      api
        .previewMonitoringScope(sessionId, selection)
        .then((scope) => {
          if (ticket !== latest.current) return;
          setPreview(scope);
          setProblem(null);
        })
        .catch((err) => ticket === latest.current && setProblem(problemText(err)));
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, saved, selection, sessionId]);

  const save = useCallback(
    async (apply: boolean) => {
      setWorking("save");
      setProblem(null);
      setNotes([]);
      try {
        const scope = await api.setMonitoringScope(sessionId, selection, apply);
        setSaved(scope);
        setPreview(scope);
        setNotes(scope.notes);
        onChanged();
      } catch (err) {
        setProblem(problemText(err));
      } finally {
        setWorking(null);
      }
    },
    [onChanged, selection, sessionId]
  );

  return { saved, shown: preview ?? saved, draft, setDraft, edit, dirty, working, problem, notes, save };
}

/** Which nodes monitoring covers. Click a node to cycle it; selectors are under "Advanced". */
export function MonitoringScopeEditor({ sessionId, enabled, onChanged }: {
  sessionId: string;
  enabled: boolean;
  onChanged: () => void;
}) {
  const { saved, shown, draft, setDraft, edit, dirty, working, problem, notes, save } = useScopeEditor(
    sessionId,
    enabled,
    onChanged
  );
  const [advanced, setAdvanced] = useState(false);
  if (!enabled) return null;
  const busy = working !== null;
  const locked = busy || !saved;
  const canApply = Boolean(saved?.canApply);
  const blocked = busy || Boolean(shown?.errors.length);
  const universe = shown?.universe ?? [];

  // A click turns the picture into explicit node names, so the selectors always say what the chips show.
  const cycle = (clicked: MonitoringScopeNode) => {
    const state = (node: MonitoringScopeNode) => (node.name === clicked.name ? NEXT_STATE[node.state] : node.state);
    const monitored = universe.filter((node) => state(node) !== "off").map((node) => node.name);
    const light = universe.filter((node) => state(node) === "host").map((node) => node.name);
    edit({ nodes: monitored.length === universe.length ? "" : monitored.join("\n"), light: light.join("\n") });
  };

  return (
    <SetupSection title="Nodes" value={shown ? summary(shown) : ""} defaultExpanded>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {PRESETS.map((preset) => (
          <Tooltip key={preset.label} title={preset.tip}>
            <Chip size="small" variant="outlined" clickable label={preset.label} disabled={locked} onClick={() => edit(preset.set)} />
          </Tooltip>
        ))}
      </Stack>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {universe.slice(0, CHIP_LIMIT).map((node) => (
          <Tooltip key={node.name} title={`${STATE_TEXT[node.state]} · ${[node.device, node.role, ...node.groups].filter(Boolean).join(" · ")}`}>
            <Chip
              size="small"
              label={node.name}
              clickable
              disabled={locked}
              onClick={() => cycle(node)}
              color={STATE_COLOR[node.state]}
              variant={node.state === "full" ? "filled" : "outlined"}
              sx={node.state === "off" ? { opacity: 0.4, textDecoration: "line-through" } : undefined}
            />
          </Tooltip>
        ))}
        {universe.length > CHIP_LIMIT && (
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>+{universe.length - CHIP_LIMIT} more</Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.disabled" component="div" sx={{ mt: 0.75 }}>
        Click: monitored → host only → off
      </Typography>
      <Messages problem={problem} shown={shown} notes={notes} />
      {dirty && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <Tooltip title={canApply ? "Restarts monitoring (about 15 s); the lab is untouched." : "Takes effect on the next deploy."}>
            <span>
              <Button size="small" variant="contained" disabled={blocked} onClick={() => void save(canApply)}>
                {canApply ? "Apply" : "Save"}
              </Button>
            </span>
          </Tooltip>
          {canApply && (
            <Button size="small" disabled={blocked} onClick={() => void save(false)}>Save only</Button>
          )}
          {saved && <Button size="small" color="inherit" disabled={busy} onClick={() => setDraft(toDraft(saved))}>Revert</Button>}
        </Stack>
      )}
      <Box sx={{ mt: 1.5 }}>
        <Link component="button" type="button" variant="caption" underline="hover" onClick={() => setAdvanced((open) => !open)}>
          {advanced ? "Hide selectors" : "Selectors…"}
        </Link>
      </Box>
      <Collapse in={advanced} unmountOnExit>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" multiline minRows={2} maxRows={8} label="Monitor" placeholder="every node" value={draft.nodes}
            disabled={locked} onChange={(event) => edit({ nodes: event.target.value })} slotProps={{ htmlInput: MONO }} />
          <TextField size="small" multiline minRows={1} maxRows={6} label="Host metrics only" placeholder="none" value={draft.light}
            disabled={locked} onChange={(event) => edit({ light: event.target.value })} slotProps={{ htmlInput: MONO }} />
          {/random/.test(draft.nodes + draft.light) && (
            <TextField size="small" label="Random seed" value={draft.seed} disabled={locked} sx={{ maxWidth: 160 }}
              onChange={(event) => edit({ seed: event.target.value.replace(/\D/g, "") })} />
          )}
          <Typography variant="caption" color="text.secondary" component="div">
            <code>leaf*</code> · <code>re:spine[0-9]+</code> · <code>group:pod* | first 10</code> · <code>* | random 5</code> ·{" "}
            <code>device=srlinux</code> · <code>!leaf9*</code> (exclude)
          </Typography>
        </Stack>
      </Collapse>
    </SetupSection>
  );
}
