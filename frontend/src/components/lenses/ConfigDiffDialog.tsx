import CloseIcon from "@mui/icons-material/Close";
import DifferenceOutlinedIcon from "@mui/icons-material/DifferenceOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { api, type ConfigDiffFile, type ConfigDiffResult } from "../../api/client";
import { languageForPath } from "../languageForPath";

const MonacoDiffViewer = lazy(() => import("./MonacoDiffViewer"));

function fileDiffBadge(file: ConfigDiffFile): { label: string; color: "success" | "error" | "default" | "warning" } {
  if (!file.leftPresent) return { label: "only right", color: "success" };
  if (!file.rightPresent) return { label: "only left", color: "error" };
  if (file.identical) return { label: "identical", color: "default" };
  return { label: `+${file.added} −${file.removed}`, color: "warning" };
}

interface ConfigDiffDialogProps {
  open: boolean;
  sessionId: string;
  nodes: string[];
  themeMode: "light" | "dark";
  onClose: () => void;
}

function ConfigDiffWorkspace({ result, onlyChanged, themeMode }: { result: ConfigDiffResult; onlyChanged: boolean; themeMode: "light" | "dark" }) {
  const [selectedPath, setSelectedPath] = useState("");
  const visibleFiles = useMemo(
    () => result.files.filter((file) => !onlyChanged || !file.identical),
    [onlyChanged, result.files]
  );
  const selectedFile = visibleFiles.find((file) => file.path === selectedPath) ?? visibleFiles[0];

  useEffect(() => {
    if (visibleFiles.length === 0) setSelectedPath("");
    else if (!visibleFiles.some((file) => file.path === selectedPath)) setSelectedPath(visibleFiles[0].path);
  }, [selectedPath, visibleFiles]);

  if (!selectedFile) return (
    <Box sx={{ display: "grid", placeItems: "center", flex: 1, minHeight: 240 }}>
      <Alert severity="success" variant="outlined" sx={{ maxWidth: 440 }}>
        These nodes render identical configuration. Turn off <strong>Changed only</strong> to browse every file.
      </Alert>
    </Box>
  );
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "260px minmax(0, 1fr)" }, gap: 1.5, flex: 1, minHeight: 0 }}>
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover" }}>
          <FolderOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>Configuration files</Typography>
          <Chip size="small" label={visibleFiles.length} sx={{ height: 22, minWidth: 30 }} />
        </Stack>
        <List dense disablePadding sx={{ flex: 1, overflow: "auto", p: 0.75 }}>
          {visibleFiles.map((file) => {
            const badge = fileDiffBadge(file);
            return (
              <ListItemButton
                key={file.path}
                selected={file.path === selectedFile.path}
                onClick={() => setSelectedPath(file.path)}
                sx={{ alignItems: "flex-start", borderRadius: 1.25, mb: 0.5, px: 1.25, py: 0.75 }}
              >
                <ListItemText
                  primary={file.module}
                  secondary={file.path}
                  slotProps={{
                    primary: { variant: "body2", fontWeight: 600 },
                    secondary: { noWrap: true, title: file.path },
                  }}
                  sx={{ my: 0, minWidth: 0 }}
                />
                <Chip size="small" variant="outlined" color={badge.color} label={badge.label} sx={{ height: 21, ml: 0.75, fontSize: 11 }} />
              </ListItemButton>
            );
          })}
        </List>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: { xs: 360, md: 0 }, overflow: "hidden", border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
        <Suspense fallback={<Box sx={{ display: "grid", placeItems: "center", height: "100%" }}><CircularProgress /></Box>}>
          <MonacoDiffViewer
            key={selectedFile.path}
            original={selectedFile.leftContent}
            modified={selectedFile.rightContent}
            language={languageForPath(selectedFile.path)}
            theme={themeMode}
          />
        </Suspense>
      </Box>
    </Box>
  );
}

export function ConfigDiffDialog({ open, sessionId, nodes: fallbackNodes, themeMode, onClose }: ConfigDiffDialogProps) {
  const [nodes, setNodes] = useState<string[]>(fallbackNodes);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [result, setResult] = useState<ConfigDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);

  // Source the node list from the raw topology model, which is available even
  // when `netlab create` fails (the lens bundle isn't) — so the pickers never
  // come up empty on a lab that doesn't transform.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.getModel(sessionId)
      .then((model) => {
        if (cancelled) return;
        const raw = (model as { nodes?: Record<string, unknown> }).nodes;
        const names = raw && typeof raw === "object" ? Object.keys(raw) : [];
        setNodes(names.length ? names : fallbackNodes);
      })
      .catch(() => { if (!cancelled) setNodes(fallbackNodes); });
    return () => { cancelled = true; };
  }, [open, sessionId, fallbackNodes]);

  useEffect(() => {
    if (!open) return;
    setLeft((current) => (nodes.includes(current) ? current : (nodes[0] ?? "")));
    setRight((current) => (nodes.includes(current) ? current : (nodes[1] ?? nodes[0] ?? "")));
  }, [open, nodes]);

  const load = useCallback(async () => {
    if (!left || !right) return;
    setLoading(true);
    setErrorMsg("");
    try {
      setResult(await api.getConfigDiff(sessionId, left, right));
    } catch (error) {
      // The endpoint 422s when the topology can't transform; explain instead of
      // silently blanking. 503 = netlab not installed.
      const message = error instanceof Error ? error.message : String(error);
      setResult(null);
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, left, right]);

  useEffect(() => {
    if (open && left && right) void load();
  }, [open, load, left, right]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{ paper: { sx: { height: { xs: "94vh", md: "86vh" }, borderRadius: { xs: 0, sm: 2.5 }, overflow: "hidden" } } }}
    >
      <DialogTitle sx={{ px: { xs: 2, sm: 2.5 }, py: 1.75 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 2, bgcolor: "primary.main", color: "primary.contrastText", flexShrink: 0 }}>
            <DifferenceOutlinedIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 700 }}>Compare configurations</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>Review generated files side by side</Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close comparison" sx={{ bgcolor: "action.hover" }}><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <Divider />
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
        <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ xs: "stretch", sm: "center" }} spacing={1}>
          <FormControl size="small" sx={{ minWidth: 180, flex: { sm: 1 }, maxWidth: { sm: 300 } }}>
            <InputLabel>Original node</InputLabel>
            <Select label="Original node" value={left} onChange={(event) => setLeft(event.target.value)}>
              {nodes.map((node) => <MenuItem key={node} value={node}>{node}</MenuItem>)}
            </Select>
          </FormControl>
          <Tooltip title="Swap nodes">
            <span>
              <IconButton
                size="small"
                disabled={!left || !right}
                onClick={() => { setLeft(right); setRight(left); }}
                aria-label="Swap compared nodes"
                sx={{ border: 1, borderColor: "divider", bgcolor: "background.paper", transform: { xs: "rotate(90deg)", sm: "none" }, alignSelf: "center" }}
              >
                <SwapHorizIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <FormControl size="small" sx={{ minWidth: 180, flex: { sm: 1 }, maxWidth: { sm: 300 } }}>
            <InputLabel>Modified node</InputLabel>
            <Select label="Modified node" value={right} onChange={(event) => setRight(event.target.value)}>
              {nodes.map((node) => <MenuItem key={node} value={node}>{node}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color={onlyChanged ? "warning" : "inherit"}
            variant={onlyChanged ? "contained" : "outlined"}
            onClick={() => setOnlyChanged((value) => !value)}
            aria-pressed={onlyChanged}
            sx={{ whiteSpace: "nowrap", boxShadow: "none" }}
          >
            Changed only
          </Button>
        </Stack>
      </Box>
      <DialogContent sx={{ p: { xs: 2, sm: 2.5 }, display: "flex", flexDirection: "column", minHeight: 0, bgcolor: "background.default" }}>
        {loading && <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}><CircularProgress /></Box>}
        {!loading && nodes.length === 0 && (
          <Alert severity="info">This topology has no nodes to compare.</Alert>
        )}
        {!loading && errorMsg && (
          <Alert severity="warning" sx={{ alignItems: "flex-start" }}>
            The topology must transform before configs can be generated — check the <strong>Readiness</strong> lens for what&apos;s wrong.
            <Box component="pre" sx={{ m: 0, mt: 1, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.8 }}>{errorMsg.split("\n").slice(0, 3).join("\n")}</Box>
          </Alert>
        )}
        {!loading && !errorMsg && result && (
          result.available ? (
            <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                <Chip size="small" color={result.summary.different ? "warning" : "default"} variant="outlined" label={`${result.summary.different} changed`} />
                <Chip size="small" variant="outlined" label={`${result.summary.same} identical`} />
                <Chip size="small" color={result.summary.onlyLeft ? "error" : "default"} variant="outlined" label={`${result.summary.onlyLeft} only in ${left}`} />
                <Chip size="small" color={result.summary.onlyRight ? "success" : "default"} variant="outlined" label={`${result.summary.onlyRight} only in ${right}`} />
              </Stack>
              <ConfigDiffWorkspace result={result} onlyChanged={onlyChanged} themeMode={themeMode} />
            </Stack>
          ) : (
            <Alert severity="info">
              No generated config found. Run <code>netlab create</code> (or deploy) so per-node config files exist to compare.
            </Alert>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
