import { readNumber, writeStored } from "../utils/storage";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { getApiBase, getApiWsBase } from "../api/endpoint";

const FONT_SIZE_KEY = "netlab.terminal.fontSize";
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 18;
const DEFAULT_FONT_SIZE = 13;

const clampFontSize = (value: number) =>
  Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));

function loadFontSize(): number {
  const raw = readNumber(FONT_SIZE_KEY, 0);
  return Number.isFinite(raw) && raw > 0 ? clampFontSize(raw) : DEFAULT_FONT_SIZE;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Agent CLIs read the backend machine's clipboard, which a browser paste never reaches. So an image pasted or
 * dropped into an agent or normal terminal is saved in the lab's folder by the backend and its path typed in. */
async function sendImage(file: File, sessionId: string, term: Terminal): Promise<void> {
  try {
    const response = await fetch(`${getApiBase()}/api/shell/paste-image?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { detail?: string } | null)?.detail ?? response.statusText);
    const { path } = (await response.json()) as { path: string };
    term.paste(`${path} `);
  } catch (error) {
    term.write(`\r\n\x1b[31m[could not paste the image: ${error instanceof Error ? error.message : error}]\x1b[0m\r\n`);
  }
}

/** A full-screen terminal program on the backend (an interactive wizard, an AI
 * agent CLI, …) bridged over a PTY/WebSocket the same way node shells are.
 * `path` is the WebSocket route, query string included. */
export function PtyTerminal({ path, title, onClose }: { path: string; title: string; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const theme = useTheme();
  const [fontSize, setFontSize] = useState(loadFontSize);

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
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !event.altKey) return true;
      if (event.key === "ArrowUp") return adjustFont(1), false;
      if (event.key === "ArrowDown") return adjustFont(-1), false;
      if (event.key === "0") return adjustFont(0), false;
      return true;
    });

    const imageSession = /^\/api\/(assistant\/harness\/|shell\/local)/.test(path)
      ? new URLSearchParams(path.split("?")[1] ?? "").get("sessionId")
      : null;
    const imageOf = (files: FileList | null | undefined) => Array.from(files ?? []).filter((file) => IMAGE_TYPES.includes(file.type));
    const handlePaste = (event: ClipboardEvent) => {
      const images = imageOf(event.clipboardData?.files);
      if (!imageSession || images.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      images.forEach((image) => void sendImage(image, imageSession, term));
    };
    const handleDrop = (event: DragEvent) => {
      const images = imageOf(event.dataTransfer?.files);
      if (!imageSession || images.length === 0) return;
      event.preventDefault();
      images.forEach((image) => void sendImage(image, imageSession, term));
    };
    const handleDragOver = (event: DragEvent) => {
      if (imageSession && event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const host = ref.current;
    host.addEventListener("paste", handlePaste, true);
    host.addEventListener("drop", handleDrop);
    host.addEventListener("dragover", handleDragOver);

    const ws = new WebSocket(`${getApiWsBase()}${path}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    ws.onopen = () => ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));

    term.onData((d) => ws.readyState === ws.OPEN && ws.send(new TextEncoder().encode(d)));

    const handleResize = () => {
      fit.fit();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }));
      }
    };

    window.addEventListener("resize", handleResize);
    const resizeObserver = new ResizeObserver(() => {
      if (ref.current && ref.current.clientHeight > 0) handleResize();
    });
    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener("paste", handlePaste, true);
      host.removeEventListener("drop", handleDrop);
      host.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("resize", handleResize);
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [path, theme.palette.mode]);

  useEffect(() => {
    writeStored(FONT_SIZE_KEY, String(fontSize));
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
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
          {title}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
