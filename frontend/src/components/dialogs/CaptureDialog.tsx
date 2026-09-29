import { useEffect, useState } from "react";
import {
  Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, Stack, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import { api } from "../../api/client";
import { getApiBase } from "../../api/endpoint";
import { clearCaptureRequest, useCaptureRequest } from "../../host/captureStore";

const DURATIONS = [10, 30, 60, 300];
const DURATION_KEY = "netlab.capture.seconds";

function savedDuration(): number {
  try {
    const value = Number(localStorage.getItem(DURATION_KEY));
    return DURATIONS.includes(value) ? value : 30;
  } catch {
    return 30;
  }
}

function captureUrl(lab: { sessionId: string } | { topology: string }, node: string, iface: string, seconds: number): string {
  const base = new URL(getApiBase() || window.location.origin, window.location.origin);
  const url = new URL("/api/lab/capture/pcap", base);
  url.search = new URLSearchParams({ ...lab, node, interface: iface, seconds: String(seconds) }).toString();
  return url.toString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );
}

type EdgesharkState = "checking" | "missing" | "installing" | "ready";

/** Edgeshark is what feeds Wireshark in the browser. When it is not running,
 * offer to install it here instead of sending people to a menu. */
function useEdgeshark(active: boolean) {
  const [state, setState] = useState<EdgesharkState>("checking");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState("checking");
    api.getEdgesharkStatus().then(
      (status) => { if (!cancelled) setState(status.running ? "ready" : "missing"); },
      () => { if (!cancelled) setState("missing"); },
    );
    return () => { cancelled = true; };
  }, [active]);
  const install = () => {
    setState("installing");
    setError(null);
    api.installEdgeshark().then(
      () => setState("ready"),
      (err) => { setError(err instanceof Error ? err.message : String(err)); setState("missing"); },
    );
  };
  const hint = state === "ready" || state === "checking"
    ? "Runs a Wireshark container via Edgeshark."
    : "Needs Edgeshark on the docker host. This downloads its compose file from GitHub and pulls its images, so it needs internet and takes a few minutes the first time.";
  return { state, error, hint, install };
}

/** Chooser behind the canvas' capture menu items: a pcap download, a live
 * stream into a local Wireshark, or Wireshark in the browser (Edgeshark). */
export function CaptureDialog() {
  const request = useCaptureRequest();
  const [seconds, setSeconds] = useState(savedDuration);
  const [copied, setCopied] = useState(false);
  const edgeshark = useEdgeshark(Boolean(request));
  if (!request) return null;
  const sessionLab = { sessionId: request.sessionId ?? "" };
  const durableLab = request.topologyPath ? { topology: request.topologyPath } : sessionLab;
  const live = `curl -sN '${captureUrl(durableLab, request.node, request.interface, 0)}' | wireshark -k -i -`;

  const download = () => {
    const anchor = document.createElement("a");
    anchor.href = captureUrl(sessionLab, request.node, request.interface, seconds);
    anchor.download = "";
    anchor.click();
    clearCaptureRequest();
  };

  return (
    <Dialog open onClose={clearCaptureRequest} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Capture on <Box component="span" sx={{ fontFamily: "monospace" }}>{request.node}:{request.interface}</Box>
        <IconButton aria-label="Close" onClick={clearCaptureRequest} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} divider={<Divider flexItem />}>
          <Section title="Download a pcap file">
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
              <ToggleButtonGroup size="small" exclusive value={seconds} onChange={(_event, value: number | null) => {
                if (!value) return;
                setSeconds(value);
                try { localStorage.setItem(DURATION_KEY, String(value)); } catch { /* a convenience */ }
              }}>
                {DURATIONS.map((value) => (
                  <ToggleButton key={value} value={value}>{value < 60 ? `${value} s` : `${value / 60} min`}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Button autoFocus variant="contained" size="small" startIcon={<DownloadIcon />} onClick={download}>Capture &amp; download</Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Both directions, VLAN tags kept; the file finishes after the chosen time. Open it in Wireshark.
            </Typography>
          </Section>

          <Section title="Live in your own Wireshark">
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Box component="code" sx={{ flex: 1, fontSize: "0.72rem", p: 1, borderRadius: 1, bgcolor: "action.hover", wordBreak: "break-all" }}>
                {live}
              </Box>
              <Tooltip title={copied ? "Copied" : "Copy command"}>
                <IconButton size="small" aria-label="Copy live capture command"
                  onClick={() => void navigator.clipboard.writeText(live).then(() => setCopied(true))}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Streams until you stop Wireshark (at most an hour). Add <code>-u user:password</code> to curl if the UI asks
              for a login.
            </Typography>
          </Section>

          <Section title="Wireshark in the browser">
            {edgeshark.state === "ready" || edgeshark.state === "checking" ? (
              <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} disabled={edgeshark.state === "checking"}
                onClick={() => { request.openInBrowserWireshark(); clearCaptureRequest(); }}>
                Open Wireshark tab
              </Button>
            ) : (
              <Button size="small" variant="outlined" disabled={edgeshark.state === "installing"}
                startIcon={edgeshark.state === "installing" ? <CircularProgress size={14} /> : <DownloadIcon />}
                onClick={edgeshark.install}>
                {edgeshark.state === "installing" ? "Installing Edgeshark…" : "Install Edgeshark"}
              </Button>
            )}
            <Typography variant="caption" color={edgeshark.error ? "error" : "text.secondary"} sx={{ display: "block", mt: 0.75 }}>
              {edgeshark.error ? `Install failed: ${edgeshark.error}` : edgeshark.hint}
            </Typography>
          </Section>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
