import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useNodes } from "@containerlab/clab-ui";
import BrushIcon from "@mui/icons-material/Brush";
import ClearIcon from "@mui/icons-material/DeleteSweep";
import CloseIcon from "@mui/icons-material/Close";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import { getStroke } from "perfect-freehand";

import { sendToAgent } from "../../host/agentInput";
import { loadStrokes, saveStrokes, uploadSketch } from "./sketchExport";
import {
  addStroke, clearSketch, redoStroke, removeStroke, replaceStrokes, setSketchActive, setSketchColor, setSketchTool, undoStroke, useSketch,
  type Stroke,
} from "../../host/sketchStore";

const COLORS = ["#1976d2", "#d32f2f", "#2e7d32", "#ed6c02", "#616161"];
const SIZE = 3;
const ERASE_RADIUS = 10;

/** The `.react-flow__viewport` element, which carries the pan/zoom transform. Found again if React Flow replaces it. */
function useViewport(container: HTMLElement): HTMLElement | null {
  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setViewport((current) => (current?.isConnected ? current : container.querySelector<HTMLElement>(".react-flow__viewport")));
    find();
    const observer = new MutationObserver(find);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);
  return viewport;
}

/** Screen position to flow coordinates, read from the viewport's own transform (pan = e/f, zoom = a). */
function toFlow(viewport: HTMLElement, clientX: number, clientY: number): [number, number] {
  const origin = (viewport.parentElement ?? viewport).getBoundingClientRect();
  const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
  const zoom = matrix.a || 1;
  return [(clientX - origin.left - matrix.e) / zoom, (clientY - origin.top - matrix.f) / zoom];
}

const OUTLINE = { thinning: 0.6, smoothing: 0.5, streamline: 0.5 } as const;

function pathOf(stroke: Stroke, last: boolean): string {
  const outline = getStroke(stroke.points, { ...OUTLINE, size: stroke.size, simulatePressure: false, last });
  if (outline.length < 2) return "";
  const [first, ...rest] = outline;
  // Quadratic midpoints round the polygon's corners; straight segments leave visible facets on a slow stroke.
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  for (let i = 0; i < rest.length; i++) {
    const [x0, y0] = rest[i];
    const [x1, y1] = rest[(i + 1) % rest.length];
    d += `Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`;
  }
  return `${d}Z`;
}

const distToStroke = (stroke: Stroke, x: number, y: number): number =>
  stroke.points.reduce((best, [px, py]) => Math.min(best, Math.hypot(px - x, py - y)), Infinity);

/** Draws on top of the canvas, inside the viewport element so the sketch pans and zooms with the nodes. */
export function SketchOverlay({ container, sessionId }: { container: HTMLElement; sessionId: string }) {
  const sketch = useSketch();
  const viewport = useViewport(container);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [live, setLive] = useState<Stroke | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const frame = useRef(0);

  // Our own element inside the viewport, so React never reconciles against React Flow's children.
  useEffect(() => {
    if (!viewport) return undefined;
    const element = document.createElement("div");
    element.style.cssText = "position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:6";
    viewport.appendChild(element);
    setHost(element);
    return () => { element.remove(); setHost(null); };
  }, [viewport]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The drawing belongs to the lab: load it when the lab opens, and save changes a moment after the last one.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadedFor.current = null;
    replaceStrokes([]);
    loadStrokes(sessionId)
      .then((strokes) => { if (!cancelled) { replaceStrokes(strokes); loadedFor.current = sessionId; } })
      .catch(() => { if (!cancelled) loadedFor.current = sessionId; });
    return () => { cancelled = true; };
  }, [sessionId]);
  useEffect(() => {
    if (loadedFor.current !== sessionId) return undefined;
    const timer = setTimeout(() => void saveStrokes(sessionId, sketch.strokes).catch(() => undefined), 800);
    return () => clearTimeout(timer);
  }, [sessionId, sketch.strokes]);

  const erase = useCallback((event: React.PointerEvent) => {
    if (!viewport) return;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
    const [x, y] = toFlow(viewport, event.clientX, event.clientY);
    const hit = sketch.strokes.find((stroke) => distToStroke(stroke, x, y) <= ERASE_RADIUS / zoom);
    if (hit) removeStroke(hit.id);
  }, [sketch.strokes, viewport]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (sketch.tool === "eraser") { erase(event); return; }
    const [x, y] = toFlow(viewport, event.clientX, event.clientY);
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
    // A mouse reports a constant 0.5; a pen reports real pressure.
    drawing.current = { id: crypto.randomUUID(), color: sketch.color, size: SIZE / zoom, points: [[x, y, event.pressure || 0.5]] };
    setLive(drawing.current);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewport) return;
    if (sketch.tool === "eraser") { if (event.buttons) erase(event); return; }
    const stroke = drawing.current;
    if (!stroke) return;
    // Coalesced events keep a fast pen stroke smooth between frames.
    for (const e of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
      const [x, y] = toFlow(viewport, e.clientX, e.clientY);
      stroke.points.push([x, y, e.pressure || 0.5]);
    }
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setLive({ ...stroke }); });
  };

  const onPointerUp = () => {
    const stroke = drawing.current;
    drawing.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setLive(null);
    if (stroke && stroke.points.length > 1) addStroke(stroke);
  };

  const paths = useMemo(() => sketch.strokes.map((stroke) => ({ id: stroke.id, color: stroke.color, d: pathOf(stroke, true) })), [sketch.strokes]);
  const livePath = live ? pathOf(live, false) : "";

  return (
    <>
      {host && createPortal(
        <svg width="1" height="1" style={{ overflow: "visible", position: "absolute", top: 0, left: 0 }}>
          {paths.map((p) => <path key={p.id} d={p.d} fill={p.color} />)}
          {live && <path d={livePath} fill={live.color} />}
        </svg>,
        host,
      )}
      {!sketch.active && createPortal(
        <Tooltip title="Draw a sketch on the canvas">
          <Paper elevation={3} sx={{ position: "absolute", bottom: 16, left: 16, zIndex: 8, borderRadius: "50%" }}>
            <IconButton size="small" onClick={() => setSketchActive(true)}><BrushIcon fontSize="small" /></IconButton>
          </Paper>
        </Tooltip>,
        container,
      )}
      {sketch.active && createPortal(
        <>
          <Box
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            sx={{ position: "absolute", inset: 0, zIndex: 7, touchAction: "none", cursor: sketch.tool === "eraser" ? "cell" : "crosshair" }}
          />
          <SketchToolbar sessionId={sessionId} />
        </>,
        container,
      )}
    </>
  );
}

const REQUEST = "I drew a sketch of the lab I want. Call get_sketch, open the image, and build the topology from it. "
  + "If anything is unclear (device types, addressing, protocols), ask me before you propose. Then call propose_topology_edit so I can review it.";

function SketchToolbar({ sessionId }: { sessionId: string }) {
  const sketch = useSketch();
  const nodes = useNodes();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const generate = async () => {
    setBusy(true);
    setNote("");
    try {
      const boxes = nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? node.width ?? 64, height: node.measured?.height ?? node.height ?? 64 }));
      await uploadSketch(sessionId, sketch.strokes, boxes);
      // The picture is saved either way; without an agent the user can start one and ask it to read the sketch.
      setNote(sendToAgent(sessionId, REQUEST)
        ? "Sent to your agent. Answer its questions in its terminal; the result appears here as a proposal."
        : "Sketch saved. No agent is running for this lab: start one in the AI agents panel (Ctrl+I), then press Generate again.");
    } catch (error) {
      setNote(`Could not save the sketch: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper elevation={4} sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 9, px: 0.75, py: 0.25 }}>
      <Stack direction="row" spacing={0.25} alignItems="center">
        <Tooltip title="Pen"><IconButton size="small" color={sketch.tool === "pen" ? "primary" : "default"} onClick={() => setSketchTool("pen")}><BrushIcon fontSize="small" /></IconButton></Tooltip>
        {COLORS.map((color) => (
          <Box key={color} onClick={() => setSketchColor(color)} sx={{ width: 18, height: 18, borderRadius: "50%", bgcolor: color, cursor: "pointer", border: 2, borderColor: sketch.tool === "pen" && sketch.color === color ? "text.primary" : "transparent" }} />
        ))}
        <Tooltip title="Eraser (removes whole strokes)"><IconButton size="small" color={sketch.tool === "eraser" ? "primary" : "default"} onClick={() => setSketchTool("eraser")}><ClearIcon fontSize="small" sx={{ transform: "scaleY(-1)" }} /></IconButton></Tooltip>
        <Tooltip title="Undo"><span><IconButton size="small" disabled={sketch.strokes.length === 0} onClick={undoStroke}><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Redo"><IconButton size="small" onClick={redoStroke}><RedoIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Clear sketch"><span><IconButton size="small" disabled={sketch.strokes.length === 0} onClick={clearSketch}><ClearIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Send the sketch to your AI agent, which builds the topology and asks if anything is unclear">
          <span>
            <Button size="small" variant="contained" disabled={busy || sketch.strokes.length === 0} startIcon={busy ? <CircularProgress size={14} /> : <AutoFixHighIcon fontSize="small" />} onClick={() => void generate()} sx={{ ml: 0.5 }}>Generate</Button>
          </span>
        </Tooltip>
        <Tooltip title="Close drawing mode"><IconButton size="small" onClick={() => setSketchActive(false)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
      {note && <Typography variant="caption" sx={{ display: "block", maxWidth: 420, px: 0.5, pb: 0.5 }}>{note}</Typography>}
    </Paper>
  );
}
