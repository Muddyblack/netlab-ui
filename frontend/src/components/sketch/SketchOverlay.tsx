import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useIsLocked, useNodes } from "@containerlab/clab-ui";
import BrushIcon from "@mui/icons-material/Brush";
import ClearIcon from "@mui/icons-material/DeleteSweep";
import EraserIcon from "@mui/icons-material/CleaningServices";
import SelectIcon from "@mui/icons-material/NearMe";
import CloseIcon from "@mui/icons-material/Close";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import { getStroke } from "perfect-freehand";

import { openAgentsPanel, sendToAgent } from "../../host/agentInput";
import { uploadSketch, type SketchNote } from "./sketchExport";
import {
  addStrokes, redoStroke, removeStrokes, resetSketchHistory, setSketchActive, setSketchColor, setSketchTool, undoStroke, useSketch,
} from "../../host/sketchStore";
import { annotationOfNode, distToStroke, freehandApi, isFreehand, strokeOfNode, strokeToAnnotation, type Stroke } from "./freehand";

const COLORS = ["#1976d2", "#d32f2f", "#2e7d32", "#ed6c02", "#616161"];
const SIZE = 3;
const ERASE_RADIUS = 10;
/** What a drawing press may start on: the empty canvas or a node or edge, not the app's own panels over it. */
const CANVAS_TARGET = ".react-flow__pane, .react-flow__node, .react-flow__edge";

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

/**
 * Draws on the canvas. Strokes are saved as annotations (patched into clab-ui); only the one being drawn lives here.
 *
 * Nothing sits over the canvas: a plain left press on it is taken for drawing, and every other input (middle drag to
 * pan, wheel to zoom, right click for the menu, Space-drag) reaches the canvas untouched, so the mouse works as it does outside draw mode.
 */
export function SketchOverlay({ container, sessionId }: { container: HTMLElement; sessionId: string }) {
  const sketch = useSketch();
  const nodes = useNodes();
  const locked = useIsLocked();
  const viewport = useViewport(container);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [live, setLive] = useState<Stroke | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const erasing = useRef(false);
  const frame = useRef(0);
  const drawable = Boolean(freehandApi) && !locked;

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
  useEffect(() => { resetSketchHistory(); }, [sessionId]);
  // Locking the lab ends drawing mode, since a locked lab cannot take new annotations.
  useEffect(() => { if (locked) setSketchActive(false); }, [locked]);

  const erase = (event: PointerEvent) => {
    if (!viewport) return;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
    const [x, y] = toFlow(viewport, event.clientX, event.clientY);
    const hit = nodes.find((node) => isFreehand(node) && distToStroke(strokeOfNode(node), x, y) <= ERASE_RADIUS / zoom);
    if (hit) removeStrokes([annotationOfNode(hit)]);
  };

  const onDown = (event: PointerEvent) => {
    if (!viewport) return;
    const target = event.target as Element;
    if (event.button !== 0 || !target.closest(CANVAS_TARGET) || target.closest("[data-sketch-ui]")) return;
    // Cancelling the press also stops the canvas from starting a pan or a node drag from it.
    event.preventDefault();
    event.stopPropagation();
    if (sketch.tool === "eraser") { erasing.current = true; erase(event); return; }
    const [x, y] = toFlow(viewport, event.clientX, event.clientY);
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
    // A mouse reports a constant 0.5; a pen reports real pressure.
    drawing.current = { id: crypto.randomUUID(), color: sketch.color, size: SIZE / zoom, points: [[x, y, event.pressure || 0.5]] };
    setLive(drawing.current);
  };

  const onMove = (event: PointerEvent) => {
    if (!viewport) return;
    if (erasing.current) { erase(event); return; }
    const stroke = drawing.current;
    if (!stroke) return;
    // Coalesced events keep a fast pen stroke smooth between frames.
    for (const e of event.getCoalescedEvents?.() ?? [event]) {
      const [x, y] = toFlow(viewport, e.clientX, e.clientY);
      stroke.points.push([x, y, e.pressure || 0.5]);
    }
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setLive({ ...stroke }); });
  };

  const onUp = () => {
    erasing.current = false;
    const stroke = drawing.current;
    drawing.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setLive(null);
    if (stroke && stroke.points.length > 1) addStrokes([strokeToAnnotation(stroke)]);
  };

  // The listeners are added once per mode; they call the newest handlers, which see the current nodes and tool.
  const latest = useRef({ onDown, onMove, onUp });
  latest.current = { onDown, onMove, onUp };
  useEffect(() => {
    if (!sketch.active || sketch.tool === "select") return undefined;
    const down = (event: PointerEvent) => latest.current.onDown(event);
    const move = (event: PointerEvent) => latest.current.onMove(event);
    const up = () => latest.current.onUp();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setSketchActive(false); };
    // Linux browsers act on a middle click (paste, autoscroll) or a right-button release (their own menu). Cancel only
    // those defaults on the canvas; the events still reach it, so panning and its own context menu work as before.
    const noBrowserDefaults = (event: MouseEvent) => {
      if ((event.button === 1 || event.type === "contextmenu") && (event.target as Element).closest(CANVAS_TARGET)) event.preventDefault();
    };
    const guarded = ["mousedown", "mouseup", "auxclick", "contextmenu"] as const;
    for (const type of guarded) container.addEventListener(type, noBrowserDefaults, true);
    container.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    container.style.cursor = sketch.tool === "eraser" ? "cell" : "crosshair";
    return () => {
      for (const type of guarded) container.removeEventListener(type, noBrowserDefaults, true);
      container.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      container.style.cursor = "";
    };
  }, [container, sketch.active, sketch.tool]);

  const livePath = useMemo(() => (live ? pathOf(live, false) : ""), [live]);

  if (!freehandApi) return null;
  return (
    <>
      {host && live && createPortal(
        <svg width="1" height="1" style={{ overflow: "visible", position: "absolute", top: 0, left: 0 }}>
          <path d={livePath} fill={live.color} />
        </svg>,
        host,
      )}
      {!sketch.active && createPortal(
        <Tooltip title={locked ? "Unlock the lab to draw" : "Draw on the canvas"}>
          <Paper elevation={3} sx={{ position: "absolute", bottom: 16, left: 16, zIndex: 8, borderRadius: "50%" }}>
            <span>
              <IconButton size="small" disabled={!drawable} onClick={() => setSketchActive(true)}><BrushIcon fontSize="small" /></IconButton>
            </span>
          </Paper>
        </Tooltip>,
        container,
      )}
      {sketch.active && createPortal(<SketchToolbar sessionId={sessionId} />, container)}
    </>
  );
}

const REQUEST = "I drew a sketch of the lab I want. Call get_sketch, open the image, and build the topology from it. "
  + "If anything is unclear (device types, addressing, protocols), ask me before you propose. Then call propose_topology_edit so I can review it.";

/** With a selection, the picture holds only what the user picked, to be added to the lab as it stands. */
const SCOPED_REQUEST = "I selected part of my sketch to add to the lab. Call get_sketch and open the image: the grey boxes already exist, "
  + "so keep them as they are and build only the coloured drawing, text and shapes as additions. "
  + "If anything is unclear (device types, addressing, protocols), ask me before you propose. Then call propose_topology_edit so I can review it.";

const ANNOTATION_TYPES = new Set(["free-text-node", "free-shape-node"]);
/** Nodes that are not devices: annotations and groups, which must not be drawn as grey device boxes. */
const NOT_DEVICES = new Set([...ANNOTATION_TYPES, "group-node", "traffic-rate-node"]);

type CanvasNode = ReturnType<typeof useNodes>[number];

function noteOf(node: CanvasNode): SketchNote | null {
  const { x, y } = node.position;
  const data = node.data as Record<string, unknown>;
  if (node.type === "free-text-node") return typeof data.text === "string" && data.text ? { kind: "text", x, y, text: data.text } : null;
  if (node.type !== "free-shape-node") return null;
  const color = typeof data.borderColor === "string" ? data.borderColor : "#424242";
  if (data.shapeType === "line") {
    const start = (data.startPosition as { x: number; y: number } | undefined) ?? { x, y };
    const end = (data.endPosition as { x: number; y: number } | undefined)
      ?? { x: start.x + ((data.relativeEndPosition as { x: number } | undefined)?.x ?? 0), y: start.y + ((data.relativeEndPosition as { y: number } | undefined)?.y ?? 0) };
    return { kind: "line", x: start.x, y: start.y, x2: end.x, y2: end.y, color };
  }
  const kind = data.shapeType === "circle" ? "circle" : "rectangle";
  return { kind, x, y, width: node.measured?.width ?? (data.width as number | undefined) ?? 100, height: node.measured?.height ?? (data.height as number | undefined) ?? 100, color };
}

function SketchToolbar({ sessionId }: { sessionId: string }) {
  const sketch = useSketch();
  const nodes = useNodes();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const hasAnnotations = nodes.some((node) => ANNOTATION_TYPES.has(node.type ?? ""));

  const generate = async () => {
    setBusy(true);
    setNote("");
    try {
      const devices = nodes.filter((node) => !NOT_DEVICES.has(node.type ?? ""));
      const boxes = devices.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, width: node.measured?.width ?? node.width ?? 64, height: node.measured?.height ?? node.height ?? 64 }));
      // Anything selected (strokes, annotations, devices) narrows the request to that; nothing selected means all of it.
      const scoped = nodes.some((node) => node.selected);
      const strokes = nodes.filter((node) => isFreehand(node) && (!scoped || node.selected)).map(strokeOfNode);
      const notes = nodes
        .filter((node) => ANNOTATION_TYPES.has(node.type ?? "") && !isFreehand(node) && (!scoped || node.selected))
        .map(noteOf)
        .filter((item): item is SketchNote => item !== null);
      const chosen = devices.filter((node) => node.selected).map((node) => node.id);
      const request = scoped
        ? `${SCOPED_REQUEST}${chosen.length ? ` Existing devices I selected as the anchor: ${chosen.join(", ")}.` : ""}`
        : REQUEST;
      await uploadSketch(sessionId, strokes, boxes, notes);
      if (sendToAgent(sessionId, request)) {
        setNote("Sent to your agent. Answer its questions in its terminal; the result appears here as a proposal.");
        return;
      }
      // The picture is saved either way. With no agent open, hand over the prompt and send the user to pick one.
      const copied = await navigator.clipboard?.writeText(request).then(() => true, () => false);
      openAgentsPanel();
      setNote(copied
        ? "Sketch saved and the prompt is copied. Pick an agent in the AI agents panel, then paste it there."
        : "Sketch saved. Pick an agent in the AI agents panel, then ask it to read the sketch (get_sketch).");
    } catch (error) {
      setNote(`Could not save the sketch: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper data-sketch-ui elevation={4} sx={{ position: "absolute", bottom: 16, left: 16, zIndex: 9, px: 0.75, py: 0.25 }}>
      <Stack direction="row" spacing={0.25} alignItems="center">
        <Tooltip title="Pen: the left button draws. Middle drag pans, wheel zooms, right click opens the canvas menu, Esc leaves draw mode"><IconButton size="small" color={sketch.tool === "pen" ? "primary" : "default"} onClick={() => setSketchTool("pen")}><BrushIcon fontSize="small" /></IconButton></Tooltip>
        {COLORS.map((color) => (
          <Box key={color} onClick={() => setSketchColor(color)} sx={{ width: 18, height: 18, borderRadius: "50%", bgcolor: color, cursor: "pointer", border: 2, borderColor: sketch.tool === "pen" && sketch.color === color ? "text.primary" : "transparent" }} />
        ))}
        <Tooltip title="Eraser: drag over strokes to remove them"><IconButton size="small" color={sketch.tool === "eraser" ? "primary" : "default"} onClick={() => setSketchTool("eraser")}><EraserIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Select: the draw layer steps aside so you can pick, move and delete strokes, nodes and annotations. Generate then uses only the selection"><IconButton size="small" color={sketch.tool === "select" ? "primary" : "default"} onClick={() => setSketchTool("select")}><SelectIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="Undo"><span><IconButton size="small" disabled={!sketch.canUndo} onClick={undoStroke}><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Redo"><span><IconButton size="small" disabled={!sketch.canRedo} onClick={redoStroke}><RedoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Clear all strokes (undo brings them back)"><span><IconButton size="small" disabled={!nodes.some(isFreehand)} onClick={() => removeStrokes(nodes.filter(isFreehand).map(annotationOfNode))}><ClearIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Send the sketch to your AI agent, which builds the topology and asks if anything is unclear">
          <span>
            <Button size="small" variant="contained" disabled={busy || !hasAnnotations} startIcon={busy ? <CircularProgress size={14} /> : <AutoFixHighIcon fontSize="small" />} onClick={() => void generate()} sx={{ ml: 0.5 }}>Generate</Button>
          </span>
        </Tooltip>
        <Tooltip title="Close drawing mode"><IconButton size="small" onClick={() => setSketchActive(false)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
      </Stack>
      {note && <Typography variant="caption" sx={{ display: "block", maxWidth: 420, px: 0.5, pb: 0.5 }}>{note}</Typography>}
    </Paper>
  );
}
