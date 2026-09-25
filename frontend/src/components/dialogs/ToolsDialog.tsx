import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Link, Stack, Switch,
  Tooltip, Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import TerminalIcon from "@mui/icons-material/Terminal";

import { api, type LabTool, type LabTools } from "../../api/client";
import { openToolsDialog, useToolsDialogRequest } from "../../host/toolsDialogStore";

/** A tool's URL as netlab prints it names the lab host as netlab sees it
 * (127.0.0.1 unless you're on SSH). Opened from a browser on another
 * machine, the lab host is the one serving this UI. */
export function reachableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const local = ["127.0.0.1", "localhost", "[::1]"];
    if (local.includes(parsed.hostname) && !local.includes(window.location.hostname)) {
      parsed.hostname = window.location.hostname;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusChip(tool: LabTool, labDeployed: boolean) {
  if (tool.deployed) {
    return tool.running
      ? <Chip size="small" color="success" label="Running" />
      : <Chip size="small" variant="outlined" label="Stopped" />;
  }
  if (tool.enabled && labDeployed) return <Chip size="small" variant="outlined" color="warning" label="Starts on next deploy" />;
  return null;
}

function hint(tool: LabTool, labDeployed: boolean): string {
  if (!labDeployed) return tool.enabled ? "Starts when you deploy the lab." : "";
  if (tool.enabled && !tool.deployed) return "netlab renders its config and starts it on the next deploy (or restart) of the lab.";
  if (!tool.enabled && tool.deployed) return "Removed from the lab — it stops at the next deploy. Stop it now if you like.";
  return "";
}

function ToolRow({ tool, labDeployed, busy, onToggle, onAction, onConnect }: {
  tool: LabTool;
  labDeployed: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onAction: (action: "up" | "down") => void;
  onConnect: () => void;
}) {
  const note = hint(tool, labDeployed);
  return (
    <Box sx={{ border: 1, borderColor: tool.enabled ? "primary.main" : "divider", borderRadius: 1.5, p: 1.5 }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Tooltip title={tool.enabled ? "Stop starting it with the lab" : "Start it with the lab"}>
          <Switch checked={tool.enabled} disabled={busy} onChange={(_event, on) => onToggle(on)}
            slotProps={{ input: { "aria-label": `Start ${tool.title} with the lab` } }} />
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">{tool.title}</Typography>
            {statusChip(tool, labDeployed)}
            {busy && <CircularProgress size={14} />}
          </Stack>
          {tool.description && <Typography variant="body2" color="text.secondary">{tool.description}</Typography>}
          {note && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{note}</Typography>}
          {tool.deployed && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              {tool.running && tool.urls.map((url, index) => (
                <Button key={url} size="small" variant="contained" startIcon={<OpenInNewIcon />}
                  href={reachableUrl(url)} target="_blank" rel="noopener noreferrer">
                  {tool.urls.length > 1 ? `Open ${index + 1}` : "Open"}
                </Button>
              ))}
              {tool.running && tool.canConnect && (
                <Button size="small" variant="outlined" startIcon={<TerminalIcon />} onClick={onConnect}>Connect</Button>
              )}
              {tool.running
                ? <Button size="small" color="inherit" startIcon={<StopIcon />} disabled={busy} onClick={() => onAction("down")}>Stop</Button>
                : <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} disabled={busy} onClick={() => onAction("up")}>Start</Button>}
            </Stack>
          )}
        </Box>
        <Link href={tool.docsUrl} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ whiteSpace: "nowrap" }}>Docs</Link>
      </Stack>
    </Box>
  );
}

/** netlab's external tools (`tools:`) for one lab: which start with it, and
 * for a deployed lab, their state with Open / Connect / Start / Stop. */
export function ToolsDialog() {
  const request = useToolsDialogRequest();
  const [data, setData] = useState<LabTools | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<{ tool: string; text: string } | null>(null);
  const sessionId = request?.sessionId ?? null;

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      setData(await api.getLabTools(sessionId));
    } catch (err) {
      setError({ tool: "", text: errorText(err) });
    }
  }, [sessionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    void load();
  }, [load]);

  if (!request || !sessionId) return null;
  const close = () => openToolsDialog(null);

  const run = async (tool: LabTool, work: () => Promise<void>) => {
    setBusy((prev) => ({ ...prev, [tool.id]: true }));
    setError(null);
    try {
      await work();
    } catch (err) {
      setError({ tool: tool.title, text: errorText(err) });
    } finally {
      setBusy((prev) => ({ ...prev, [tool.id]: false }));
    }
  };

  const toggle = (tool: LabTool, on: boolean) => run(tool, async () => setData(await api.setLabTool(sessionId, tool.id, on)));
  const act = (tool: LabTool, action: "up" | "down") => run(tool, async () => {
    const result = await api.labToolAction(sessionId, tool.id, action);
    if (result.code) setError({ tool: tool.title, text: result.stderr || result.stdout });
    await load();
  });

  const tools = data?.tools ?? [];
  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        External tools
        <Typography variant="body2" color="text.secondary">
          Tools netlab runs next to the lab (<code>tools:</code>). Switch one on and it starts with every deploy.
        </Typography>
        <IconButton aria-label="Close" onClick={close} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {error.tool ? `${error.tool}: ` : ""}{error.text}
          </Alert>
        )}
        {!data && !error && <Stack alignItems="center" sx={{ py: 4 }}><CircularProgress size={24} /></Stack>}
        {data && tools.length === 0 && (
          <Typography color="text.secondary">This netlab defines no external tools.</Typography>
        )}
        <Stack spacing={1}>
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} labDeployed={data?.deployed ?? false} busy={Boolean(busy[tool.id])}
              onToggle={(on) => void toggle(tool, on)}
              onAction={(action) => void act(tool, action)}
              onConnect={() => { request.openShell(tool.id); close(); }} />
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
