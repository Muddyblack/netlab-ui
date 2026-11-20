import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton, Paper, Tooltip } from "@mui/material";
import { useIsLocked, useNodes } from "@containerlab/clab-ui";
import BrushIcon from "@mui/icons-material/Brush";

import { addStrokes, removeStrokes, resetSketchHistory, setSketchActive, useSketch } from "../../host/sketchStore";
import { SketchToolbar } from "./SketchToolbar";
import { annotationOfNode, distToStroke, freehandApi, isFreehand, pathOf, strokeOfNode, strokeToAnnotation, type Stroke } from "./freehand";

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
              <IconButton size="small" aria-label="Draw on the canvas" disabled={!drawable} onClick={() => setSketchActive(true)}><BrushIcon fontSize="small" /></IconButton>
            </span>
          </Paper>
        </Tooltip>,
        container,
      )}
      {sketch.active && createPortal(<SketchToolbar sessionId={sessionId} />, container)}
    </>
  );
}
