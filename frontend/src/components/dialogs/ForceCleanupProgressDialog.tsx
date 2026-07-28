import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { getApiBase } from "../../api/endpoint";

interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
}

interface ForceCleanupProgressDialogProps {
  open: boolean;
  instanceId: string | null;
  onClose: () => void;
  /** Fired once the stream finishes (or errors), success reflecting exit code 0. */
  onDone: (success: boolean) => void;
}

/** Streams `POST /api/lab/instances/{id}/force-cleanup/stream` live, the same
 * simple stdout/stderr framing `/lifecycle/stream` uses. This is deliberately
 * a standalone dialog rather than clab-ui's native lifecycle modal — force
 * cleanup operates on an arbitrary globally-tracked instance that may have no
 * open session (or even an existing directory) to hang that modal off of. */
export function ForceCleanupProgressDialog({ open, instanceId, onClose, onDone }: ForceCleanupProgressDialogProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (id: string) => {
    setLines([]);
    setExitCode(null);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${getApiBase()}/api/lab/instances/${encodeURIComponent(id)}/force-cleanup/stream`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let code: number | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const frame = JSON.parse(dataLine.slice(6));
          if (frame.line !== undefined) {
            setLines((prev) => [...prev, { stream: frame.stream === "stderr" ? "stderr" : "stdout", line: frame.line }]);
          } else if (frame.done) {
            code = typeof frame.code === "number" ? frame.code : 1;
          } else if (frame.error) {
            setLines((prev) => [...prev, { stream: "stderr", line: frame.error }]);
            code = 1;
          }
        }
      }
      setExitCode(code ?? 1);
      onDone((code ?? 1) === 0);
    } catch (err) {
      if (controller.signal.aborted) return;
      setLines((prev) => [...prev, { stream: "stderr", line: err instanceof Error ? err.message : String(err) }]);
      setExitCode(1);
      onDone(false);
    } finally {
      setRunning(false);
    }
    // onDone is intentionally excluded — this effect should only re-run when
    // the target instance changes, not whenever the parent re-renders with a
    // new callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open && instanceId) void run(instanceId);
    return () => abortRef.current?.abort();
  }, [open, instanceId, run]);

  const asText = lines.map((l) => l.line).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const statusLabel = running ? "Running" : exitCode === 0 ? "Succeeded" : exitCode != null ? `Failed (exit ${exitCode})` : null;

  return (
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Force cleanup{instanceId ? ` · ${instanceId}` : ""}
            </Typography>
            <Typography variant="caption" color="text.secondary">Live command output</Typography>
          </Box>
          {running && <CircularProgress size={18} />}
          {statusLabel && (
            <Chip size="small" label={statusLabel} color={running ? "default" : exitCode === 0 ? "success" : "error"} variant="outlined" />
          )}
          <Tooltip title={copied ? "Copied" : "Copy output"}>
            <span>
              <IconButton size="small" onClick={() => void copy()} disabled={!asText} sx={{ color: copied ? "success.main" : "inherit" }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.25,
            borderRadius: 1,
            bgcolor: "action.hover",
            minHeight: 120,
            maxHeight: "60vh",
            overflow: "auto",
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {lines.length === 0
            ? <Typography variant="body2" color="text.secondary">Waiting for output…</Typography>
            : lines.map((entry, index) => (
              <Box
                key={index}
                component="span"
                sx={{
                  display: "block",
                  color: entry.stream === "stderr" ? "#f87171" : "inherit",
                  bgcolor: entry.stream === "stderr" ? "rgba(239, 68, 68, 0.10)" : "transparent",
                }}
              >
                {entry.line || " "}
              </Box>
            ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={running} sx={{ textTransform: "none" }}>
          {running ? <CircularProgress size={16} /> : "OK"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
