import { useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography
} from "@mui/material";

import { getApiBase } from "../../api/endpoint";
import { readCommandStream, type LogLine } from "../../api/commandStream";

// Tools log progress to stderr too (containerlab's INFO lines); only lines
// that read like a failure get the error colour.
const FAILURE_RE = /\b(error|fatal|failed|traceback)\b/i;

function lineColor(entry: LogLine): string {
  if (FAILURE_RE.test(entry.line)) return "error.main";
  return entry.stream === "stderr" ? "text.secondary" : "inherit";
}

export interface CommandStreamRequest {
  title: string;
  /** What will happen, shown before the user starts it. */
  description: React.ReactNode;
  /** The command, shown in monospace (e.g. "netlab test clab"). */
  command: string;
  /** POST endpoint streaming `{stream, line}` / `{done, code}` frames. */
  url: string;
  body: unknown;
  startLabel?: string;
  /** Tone of the confirmation: warning for things that change the host. */
  severity?: "info" | "warning";
}

/** Confirm, then run a backend command and show its output live. Closing
 * (or Stop) ends the stream, which stops the command on the backend. */
export function CommandStreamDialog({ request, onClose, onDone }: {
  request: CommandStreamRequest | null;
  onClose: () => void;
  onDone?: (ok: boolean) => void;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<"ready" | "running" | "done">("ready");
  const [code, setCode] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLines([]);
    setState("ready");
    setCode(null);
    return () => abortRef.current?.abort();
  }, [request]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  if (!request) return null;

  const start = async () => {
    setLines([]);
    setCode(null);
    setState("running");
    const controller = new AbortController();
    abortRef.current = controller;
    let exit = 1;
    try {
      const res = await fetch(`${getApiBase()}${request.url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.json().then((data: { detail?: string }) => data.detail, () => undefined);
        throw new Error(detail || `HTTP ${res.status}`);
      }
      exit = (await readCommandStream(res.body.getReader(), (line) => setLines((prev) => [...prev, line]))) ?? 1;
    } catch (err) {
      if (controller.signal.aborted) {
        setLines((prev) => [...prev, { stream: "stderr", line: "Stopped." }]);
      } else {
        setLines((prev) => [...prev, { stream: "stderr", line: err instanceof Error ? err.message : String(err) }]);
      }
    }
    setCode(exit);
    setState("done");
    onDone?.(exit === 0);
  };

  const stop = () => abortRef.current?.abort();
  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  let chip: React.ReactNode = null;
  if (state === "running") chip = <Chip size="small" variant="outlined" label="Running" icon={<CircularProgress size={12} />} />;
  if (state === "done") chip = code === 0
    ? <Chip size="small" color="success" variant="outlined" label="Succeeded" />
    : <Chip size="small" color="error" variant="outlined" label={`Failed${code != null ? ` (exit ${code})` : ""}`} />;

  return (
    <Dialog open onClose={state === "running" ? undefined : close} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ flex: 1 }}>{request.title}</Box>
          {chip}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity={request.severity ?? "info"} sx={{ mb: 1.5 }}>
          <Box>{request.description}</Box>
          <Box component="code" sx={{ display: "inline-block", mt: 0.75, fontSize: "0.8rem" }}>{request.command}</Box>
        </Alert>
        {state !== "ready" && (
          <Box component="pre" sx={{
            m: 0, p: 1.25, borderRadius: 1, bgcolor: "action.hover", minHeight: 160, maxHeight: "55vh", overflow: "auto",
            fontSize: 12, lineHeight: 1.5, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {lines.length === 0
              ? <Typography variant="body2" color="text.secondary">Waiting for output…</Typography>
              : lines.map((entry, index) => (
                <Box key={index} component="span" sx={{ display: "block", color: lineColor(entry) }}>
                  {entry.line || " "}
                </Box>
              ))}
            <div ref={endRef} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {state === "running"
          ? <Button color="inherit" onClick={stop}>Stop</Button>
          : <Button color="inherit" onClick={close}>{state === "done" ? "Close" : "Cancel"}</Button>}
        {state !== "running" && (
          <Button variant="contained" onClick={() => void start()} autoFocus>
            {state === "done" ? "Run again" : request.startLabel ?? "Start"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
