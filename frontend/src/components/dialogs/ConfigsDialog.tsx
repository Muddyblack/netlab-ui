import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton,
  ListItemText, MenuItem, Select, Stack, Tooltip, Typography
} from "@mui/material";
import CameraAltOutlinedIcon from "@mui/icons-material/CameraAltOutlined";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";

import { api, type ConfigDrift, type ConfigSnapshot, type RunningConfigDiff } from "../../api/client";
import { openConfigsDialog, useConfigsDialogSession } from "../../host/configsDialogStore";
import { resolveThemeMode } from "../../theme";

const MonacoDiffViewer = lazy(() => import("../lenses/MonacoDiffViewer"));
const LIVE = "live";

type DriftRow = ConfigDrift["nodes"][number];

function DriftChip({ row }: { row: DriftRow }) {
  if (row.status === "changed") return <Chip size="small" color="warning" label={`+${row.added} −${row.removed}`} sx={{ height: 20 }} />;
  if (row.status === "same") return <Chip size="small" variant="outlined" color="success" label="unchanged" sx={{ height: 20 }} />;
  const label = row.status === "unavailable" ? "no CLI config" : "not in snapshot";
  return <Chip size="small" variant="outlined" label={label} sx={{ height: 20 }} />;
}

function snapshotLabel(snapshot: ConfigSnapshot): string {
  const when = new Date(snapshot.createdAt).toLocaleString();
  return `${when} — ${snapshot.reason}`;
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  // http() prefixes "<path> -> <status> "; FastAPI details are JSON.
  const body = err.message.replace(/^\/api\/\S+ -> \d+ /, "");
  try { return String((JSON.parse(body) as { detail?: unknown }).detail ?? body); } catch { return body; }
}

/** Running configurations: what changed on each device since a snapshot
 * (one is taken after every successful up/initial), and a diff between any
 * snapshot and the live configuration. */
export function ConfigsDialog() {
  const sessionId = useConfigsDialogSession();
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([]);
  const [left, setLeft] = useState<string>("");
  const [right, setRight] = useState<string>(LIVE);
  const [drift, setDrift] = useState<DriftRow[] | null>(null);
  const [node, setNode] = useState<string | null>(null);
  const [diff, setDiff] = useState<RunningConfigDiff | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const loadSnapshots = useCallback(async (select?: string) => {
    if (!sessionId) return;
    const list = (await api.listConfigSnapshots(sessionId)).snapshots;
    setSnapshots(list);
    setLeft((current) => select ?? (current && list.some((s) => s.id === current) ? current : list[0]?.id ?? ""));
  }, [sessionId]);

  useEffect(() => {
    setDrift(null); setDiff(null); setNode(null); setError(null); setRight(LIVE);
    if (sessionId) void loadSnapshots().catch((err) => setError(errorText(err)));
  }, [sessionId, loadSnapshots]);

  useEffect(() => {
    if (!sessionId || !left) return;
    let cancelled = false;
    setBusy("Comparing live configurations…");
    api.getConfigDrift(sessionId, left)
      .then((result) => {
        if (cancelled) return;
        setDrift(result.nodes);
        setNode((current) => current ?? result.nodes.find((row) => row.status === "changed")?.node ?? result.nodes[0]?.node ?? null);
      })
      .catch((err) => { if (!cancelled) setError(errorText(err)); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [sessionId, left, refresh]);

  useEffect(() => {
    if (!sessionId || !left || !node) return;
    let cancelled = false;
    api.getRunningConfigDiff(sessionId, node, left, right)
      .then((result) => { if (!cancelled) setDiff(result); })
      .catch((err) => { if (!cancelled) setError(errorText(err)); });
    return () => { cancelled = true; };
  }, [sessionId, left, right, node, refresh]);

  const takeSnapshot = async () => {
    if (!sessionId) return;
    setBusy("Reading every node's running configuration…");
    setError(null);
    try {
      const snapshot = await api.takeConfigSnapshot(sessionId);
      await loadSnapshots(snapshot.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (!sessionId) return null;
  const close = () => openConfigsDialog(null);

  return (
    <Dialog open onClose={close} maxWidth="lg" fullWidth PaperProps={{ sx: { height: "82vh" } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        Running configurations
        <IconButton aria-label="Close" onClick={close} sx={{ position: "absolute", right: 8, top: 8 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, minHeight: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">Compare</Typography>
          <Select size="small" value={left} displayEmpty onChange={(event) => { setLeft(event.target.value); setNode(null); }} sx={{ minWidth: 280 }}
            renderValue={(value) => {
              const snapshot = snapshots.find((s) => s.id === value);
              return snapshot ? snapshotLabel(snapshot) : "no snapshot yet";
            }}>
            {snapshots.map((snapshot) => <MenuItem key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</MenuItem>)}
          </Select>
          <Typography variant="body2" color="text.secondary">with</Typography>
          <Select size="small" value={right} onChange={(event) => setRight(event.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value={LIVE}>live configuration</MenuItem>
            {snapshots.filter((s) => s.id !== left).map((snapshot) => (
              <MenuItem key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</MenuItem>
            ))}
          </Select>
          <Box sx={{ flex: 1 }} />
          {busy && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={14} /><Typography variant="caption">{busy}</Typography></Stack>}
          <Tooltip title="Re-read the live configurations">
            <span><IconButton size="small" aria-label="Refresh drift" disabled={!left || Boolean(busy)} onClick={() => setRefresh((value) => value + 1)}>
              <RefreshIcon fontSize="small" />
            </IconButton></span>
          </Tooltip>
          <Button size="small" variant="contained" startIcon={<CameraAltOutlinedIcon />} disabled={Boolean(busy)} onClick={() => void takeSnapshot()}>
            Take snapshot
          </Button>
        </Stack>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {snapshots.length === 0 && !busy && (
          <Alert severity="info">
            No snapshot of this lab yet. One is taken automatically after every successful deploy or <code>netlab initial</code> — or take one now,
            change something, and come back to see exactly what changed.
          </Alert>
        )}
        <Box sx={{ display: "flex", flex: 1, minHeight: 0, gap: 1.5 }}>
          <List dense sx={{ width: 220, flexShrink: 0, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
            {(drift ?? []).map((row) => (
              <ListItemButton key={row.node} selected={row.node === node} onClick={() => setNode(row.node)}>
                <ListItemText primary={row.node} primaryTypographyProps={{ fontFamily: "monospace" }} />
                <DriftChip row={row} />
              </ListItemButton>
            ))}
          </List>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
            {diff && (
              <Stack direction="row" sx={{ px: 1.5, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
                <Typography variant="caption" sx={{ flex: 1 }}>{diff.node} · {diff.left.label}</Typography>
                <Typography variant="caption" sx={{ flex: 1 }}>{diff.right.label}</Typography>
              </Stack>
            )}
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {diff && diff.left.text !== null && diff.right.text !== null ? (
                <Suspense fallback={null}>
                  <MonacoDiffViewer original={diff.left.text ?? ""} modified={diff.right.text ?? ""} language="ini" theme={resolveThemeMode()} />
                </Suspense>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                  {diff ? `${diff.node} has no CLI running configuration in one of the two sources (Linux hosts don't).` : "Pick a node."}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
