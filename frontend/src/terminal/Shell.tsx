import { useEffect, useId, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import SyncAltIcon from "@mui/icons-material/SyncAlt";
import { getApiWsBase } from "../api/endpoint";
import { broadcastShellInput, joinShellSync, leaveShellSync, useShellSyncMembers } from "./shellSync";

const FONT_SIZE_KEY = "netlab.terminal.fontSize";
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 13;

const clampFontSize = (value: number) =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));

function loadFontSize(): number {
  const raw = Number(localStorage.getItem(FONT_SIZE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampFontSize(raw) : DEFAULT_FONT_SIZE;
}

export function Shell({ node, sessionId, onClose }: { node: string; sessionId: string; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const theme = useTheme();
  const [fontSize, setFontSize] = useState(loadFontSize);
  const syncId = useId();
  const [synced, setSynced] = useState(false);
  const syncMembers = useShellSyncMembers();

  // Keep the latest setter reachable from the (once-per-connection) key handler.
  const adjustFont = (delta: number) =>
    setFontSize((prev) => clampFontSize(delta === 0 ? DEFAULT_FONT_SIZE : prev + delta));

  useEffect(() => {
    if (!ref.current) return;

    const rootStyles = getComputedStyle(document.documentElement);
    const resolveCssVar = (name: string, fallback: string) => {
      const value = rootStyles.getPropertyValue(name).trim();
      return value || fallback;
    };

    const term = new Terminal({
      fontSize: loadFontSize(),
      convertEol: true,
      theme: {
        background: resolveCssVar("--vscode-editor-background", "#1e1e1e"),
        foreground: resolveCssVar("--vscode-editor-foreground", "#cccccc"),
        cursor: resolveCssVar("--vscode-focusBorder", "#007fd4"),
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    const host = ref.current;
    let disposed = false;
    // xterm's renderer has no dimensions while the dock is collapsed/hidden
    // or mid-teardown, and FitAddon then throws ("reading 'dimensions'").
    const safeFit = () => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      try { fit.fit(); } catch { /* renderer not ready yet; next resize refits */ }
    };
    safeFit();
    termRef.current = term;
    fitRef.current = fit;

    // Alt+Up / Alt+Down to resize, Alt+0 to reset — matches the clab app shortcuts.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !event.altKey) return true;
      if (event.key === "ArrowUp") return adjustFont(1), false;
      if (event.key === "ArrowDown") return adjustFont(-1), false;
      if (event.key === "0") return adjustFont(0), false;
      return true;
    });

    const ws = new WebSocket(`${getApiWsBase()}/api/node/${encodeURIComponent(node)}/shell?sessionId=${encodeURIComponent(sessionId)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    ws.onopen = () => ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));

    term.onData((d) => {
      const bytes = new TextEncoder().encode(d);
      // A synced shell fans its keystrokes out to every synced shell
      // (itself included) instead of only its own socket.
      if (broadcastShellInput(syncId, bytes)) return;
      if (ws.readyState === ws.OPEN) ws.send(bytes);
    });

    const handleResize = () => {
      safeFit();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      }
    };

    window.addEventListener("resize", handleResize);
    // The dock host resizes without a window resize (drag handle, maximize,
    // collapse, tab switch) — refit whenever our own box changes size.
    const resizeObserver = new ResizeObserver(() => {
      if (ref.current && ref.current.clientHeight > 0) handleResize();
    });
    resizeObserver.observe(ref.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [node, sessionId, theme.palette.mode, syncId]);

  useEffect(() => {
    if (!synced) return;
    joinShellSync(syncId, node, (bytes) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) ws.send(bytes);
    });
    return () => leaveShellSync(syncId);
  }, [synced, syncId, node]);

  // Apply font changes live without tearing down the connection.
  useEffect(() => {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    try { if (ref.current?.clientHeight) fitRef.current?.fit(); } catch { /* renderer not ready */ }
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
    }
  }, [fontSize]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.default" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          bgcolor: "var(--vscode-sideBar-background, #252526)",
          borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
        }}
      >
        <Typography variant="subtitle2" sx={{ fontFamily: "monospace", fontSize: "0.8rem", color: "text.primary" }}>
          node connect: {node}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip
            title={synced
              ? `Input is sent to all synced shells (${syncMembers.join(", ")}) — click to stop`
              : "Sync input: type into every shell that has this switched on"}
          >
            <IconButton
              size="small"
              aria-label={synced ? "Stop syncing input" : "Sync input with other shells"}
              aria-pressed={synced}
              onClick={() => setSynced((value) => !value)}
              color={synced ? "warning" : "default"}
              sx={{ width: 24, height: 24 }}
            >
              <SyncAltIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {synced && (
            <Typography variant="caption" color="warning.main" sx={{ mr: 0.5 }}>
              sync ×{syncMembers.length}
            </Typography>
          )}
          <Tooltip title="Decrease font size (Alt+Down)">
            <span>
              <IconButton
                size="small"
                onClick={() => adjustFont(-1)}
                disabled={fontSize <= MIN_FONT_SIZE}
                sx={{ fontFamily: "monospace", fontSize: "0.9rem", width: 24, height: 24 }}
              >
                A-
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Reset font size (Alt+0)">
            <Typography
              onClick={() => adjustFont(0)}
              variant="caption"
              sx={{ cursor: "pointer", minWidth: 22, textAlign: "center", color: "text.secondary", "&:hover": { color: "text.primary" } }}
            >
              {fontSize}
            </Typography>
          </Tooltip>
          <Tooltip title="Increase font size (Alt+Up)">
            <span>
              <IconButton
                size="small"
                onClick={() => adjustFont(1)}
                disabled={fontSize >= MAX_FONT_SIZE}
                sx={{ fontFamily: "monospace", fontSize: "0.9rem", width: 24, height: 24 }}
              >
                A+
              </IconButton>
            </span>
          </Tooltip>
          {onClose && (
            <Typography
              onClick={onClose}
              variant="caption"
              sx={{
                ml: 1,
                cursor: "pointer",
                opacity: 0.6,
                "&:hover": { opacity: 1 },
                fontFamily: "sans-serif"
              }}
            >
              Close
            </Typography>
          )}
        </Box>
      </Box>
      <Box ref={ref} sx={{ flexGrow: 1, minHeight: 0, p: 1, "& .xterm": { height: "100%" } }} />
    </Box>
  );
}
