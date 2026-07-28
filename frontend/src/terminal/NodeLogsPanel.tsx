import { useEffect, useMemo, useRef, useState } from "react";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SearchIcon from "@mui/icons-material/Search";
import { Box, Chip, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { getApiWsBase } from "../api/endpoint";

type LogLine = { id: number; stream: "stdout" | "stderr"; line: string };
const MAX_LINES = 5000;

export function NodeLogsPanel({ node, sessionId }: { node: string; sessionId: string }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [showStdout, setShowStdout] = useState(true);
  const [showStderr, setShowStderr] = useState(true);
  const pausedRef = useRef(paused);
  const nextId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  pausedRef.current = paused;

  useEffect(() => {
    setLines([]);
    const socket = new WebSocket(`${getApiWsBase()}/api/node/${encodeURIComponent(node)}/logs?sessionId=${encodeURIComponent(sessionId)}`);
    socket.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const value = JSON.parse(String(event.data));
        const entry: LogLine = { id: nextId.current++, stream: value.stream === "stderr" ? "stderr" : "stdout", line: String(value.line ?? "") };
        setLines((current) => [...current.slice(-(MAX_LINES - 1)), entry]);
      } catch { /* ignore malformed frames */ }
    };
    return () => socket.close();
  }, [node, sessionId]);

  const visible = useMemo(() => {
    const query = filter.toLowerCase();
    return lines.filter((entry) => (entry.stream === "stdout" ? showStdout : showStderr) && (!query || entry.line.toLowerCase().includes(query)));
  }, [filter, lines, showStderr, showStdout]);

  useEffect(() => {
    if (!paused) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [paused, visible]);

  let emptyMessage = "Waiting for log output…";
  if (lines.length) emptyMessage = "No lines match the current filter.";
  else if (paused) emptyMessage = "Stream paused.";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 1.25, py: 0.75, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ fontFamily: "monospace", mr: 0.5 }}>{node} logs</Typography>
        <TextField size="small" placeholder="Filter logs…" value={filter} onChange={(event) => setFilter(event.target.value)} sx={{ flex: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 17 }} /></InputAdornment> }} />
        <Chip size="small" clickable label="stdout" color={showStdout ? "primary" : "default"} variant={showStdout ? "filled" : "outlined"} onClick={() => setShowStdout((value) => !value)} />
        <Chip size="small" clickable label="stderr" color={showStderr ? "error" : "default"} variant={showStderr ? "filled" : "outlined"} onClick={() => setShowStderr((value) => !value)} />
        <Tooltip title={paused ? "Resume stream" : "Pause display"}><IconButton size="small" onClick={() => setPaused((value) => !value)}>{paused ? <PlayArrowIcon /> : <PauseIcon />}</IconButton></Tooltip>
        <Tooltip title="Clear"><IconButton size="small" onClick={() => setLines([])}><ClearAllIcon /></IconButton></Tooltip>
      </Stack>
      <Box ref={scrollRef} sx={{ flex: 1, minHeight: 0, overflow: "auto", bgcolor: "#111", color: "#ddd", p: 1, fontFamily: "monospace", fontSize: "0.75rem", lineHeight: 1.5 }}>
        {visible.map((entry) => <Box key={entry.id} sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: entry.stream === "stderr" ? "#ff8a80" : "inherit" }}>{entry.line || " "}</Box>)}
        {visible.length === 0 && <Typography variant="caption" sx={{ color: "#888" }}>{emptyMessage}</Typography>}
      </Box>
    </Box>
  );
}
