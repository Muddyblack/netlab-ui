import { useState } from "react";
import { Box, Button, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { useNodes } from "@containerlab/clab-ui";
import ClearIcon from "@mui/icons-material/DeleteSweep";
import EraserIcon from "@mui/icons-material/CleaningServices";
import SelectIcon from "@mui/icons-material/NearMe";
import CloseIcon from "@mui/icons-material/Close";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import BrushIcon from "@mui/icons-material/Brush";

import { openAgentsPanel, sendToAgent } from "../../host/agentInput";
import { uploadSketch, type SketchNote } from "./sketchExport";
import { redoStroke, removeStrokes, setSketchActive, setSketchColor, setSketchTool, undoStroke, useSketch } from "../../host/sketchStore";
import { annotationOfNode, isFreehand, strokeOfNode } from "./freehand";

const COLORS = ["#1976d2", "#d32f2f", "#2e7d32", "#ed6c02", "#616161"];

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

type ShapeData = Record<string, unknown>;

/** A line annotation: its two ends (newer annotations store the end, older ones an offset from the start). */
function lineNote(data: ShapeData, x: number, y: number, color: string): SketchNote {
  const start = (data.startPosition as { x: number; y: number } | undefined) ?? { x, y };
  const offset = (data.relativeEndPosition as { x?: number; y?: number } | undefined) ?? {};
  const end = (data.endPosition as { x: number; y: number } | undefined) ?? { x: start.x + (offset.x ?? 0), y: start.y + (offset.y ?? 0) };
  return { kind: "line", x: start.x, y: start.y, x2: end.x, y2: end.y, color };
}

/** A rectangle or circle annotation, at its drawn size. */
function shapeNote(node: CanvasNode, data: ShapeData, color: string): SketchNote {
  const kind = data.shapeType === "circle" ? "circle" : "rectangle";
  const width = node.measured?.width ?? (data.width as number | undefined) ?? 100;
  const height = node.measured?.height ?? (data.height as number | undefined) ?? 100;
  return { kind, x: node.position.x, y: node.position.y, width, height, color };
}

/** What a text or shape annotation adds to the sketch the agent gets; null for anything else. */
function noteOf(node: CanvasNode): SketchNote | null {
  const { x, y } = node.position;
  const data = node.data as ShapeData;
  if (node.type === "free-text-node") return typeof data.text === "string" && data.text ? { kind: "text", x, y, text: data.text } : null;
  if (node.type !== "free-shape-node") return null;
  const color = typeof data.borderColor === "string" ? data.borderColor : "#424242";
  return data.shapeType === "line" ? lineNote(data, x, y, color) : shapeNote(node, data, color);
}

export function SketchToolbar({ sessionId }: { sessionId: string }) {
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
