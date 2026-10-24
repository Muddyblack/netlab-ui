import { useSyncExternalStore } from "react";

import { freehandApi, type FreehandAnnotation } from "../components/sketch/freehand";

export type SketchTool = "pen" | "eraser" | "select";

export interface SketchState {
  active: boolean;
  tool: SketchTool;
  color: string;
  canUndo: boolean;
  canRedo: boolean;
}

/** One undoable change to the strokes: some drawn, or some erased. The strokes themselves are annotations in the graph. */
interface Op {
  kind: "add" | "remove";
  annotations: FreehandAnnotation[];
}

let state: SketchState = { active: false, tool: "pen", color: "#1976d2", canUndo: false, canRedo: false };
let undoStack: Op[] = [];
/** Changes taken back by undo, newest last, so redo can reapply them. */
let redoStack: Op[] = [];
/** clab-ui's session client, needed to save the annotations file after a change. */
let client: unknown = null;
const listeners = new Set<() => void>();

function set(next: Partial<SketchState>): void {
  state = { ...state, ...next, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
  for (const listener of listeners) listener();
}

export const setSketchClient = (next: unknown): void => { client = next; };
export const setSketchActive = (active: boolean): void => set({ active });
export const setSketchTool = (tool: SketchTool): void => set({ tool });
export const setSketchColor = (color: string): void => set({ color, tool: "pen" });

/** Erasing or undoing in a burst changes many strokes; one save after the last one is enough. */
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void freehandApi?.persist(client), 300);
}

function apply(op: Op, forward: boolean): void {
  const adding = (op.kind === "add") === forward;
  for (const annotation of op.annotations) {
    if (adding) freehandApi?.add(annotation);
    else freehandApi?.remove(annotation.id);
  }
  scheduleSave();
}

function record(op: Op): void {
  apply(op, true);
  undoStack.push(op);
  redoStack = [];
  set({});
}

export const addStrokes = (annotations: FreehandAnnotation[]): void => { if (annotations.length) record({ kind: "add", annotations }); };
export const removeStrokes = (annotations: FreehandAnnotation[]): void => { if (annotations.length) record({ kind: "remove", annotations }); };

export function undoStroke(): void {
  const op = undoStack.pop();
  if (!op) return;
  apply(op, false);
  redoStack.push(op);
  set({});
}

export function redoStroke(): void {
  const op = redoStack.pop();
  if (!op) return;
  apply(op, true);
  undoStack.push(op);
  set({});
}

/** Switching labs: the history belongs to the old canvas. */
export function resetSketchHistory(): void {
  undoStack = [];
  redoStack = [];
  set({});
}

export function useSketch(): SketchState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
