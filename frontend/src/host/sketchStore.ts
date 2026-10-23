import { useSyncExternalStore } from "react";

/** One pen stroke in flow coordinates, so it follows the canvas when it is panned or zoomed. */
export interface Stroke {
  id: string;
  color: string;
  /** Brush diameter in flow units. */
  size: number;
  /** [x, y, pressure] per point. */
  points: Array<[number, number, number]>;
}

export type SketchTool = "pen" | "eraser";

export interface SketchState {
  active: boolean;
  tool: SketchTool;
  color: string;
  strokes: Stroke[];
}

let state: SketchState = { active: false, tool: "pen", color: "#1976d2", strokes: [] };
/** Strokes removed by undo, newest last, so redo can bring them back. */
let redoStack: Stroke[] = [];
const listeners = new Set<() => void>();

function set(next: Partial<SketchState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const setSketchActive = (active: boolean): void => set({ active });
export const setSketchTool = (tool: SketchTool): void => set({ tool });
export const setSketchColor = (color: string): void => set({ color, tool: "pen" });

export function addStroke(stroke: Stroke): void {
  redoStack = [];
  set({ strokes: [...state.strokes, stroke] });
}

export function removeStroke(id: string): void {
  set({ strokes: state.strokes.filter((stroke) => stroke.id !== id) });
}

export function undoStroke(): void {
  const last = state.strokes[state.strokes.length - 1];
  if (!last) return;
  redoStack.push(last);
  set({ strokes: state.strokes.slice(0, -1) });
}

export function redoStroke(): void {
  const stroke = redoStack.pop();
  if (stroke) set({ strokes: [...state.strokes, stroke] });
}

/** Swap in strokes loaded from the lab (or none, on switching labs) without touching undo history. */
export function replaceStrokes(strokes: Stroke[]): void {
  redoStack = [];
  set({ strokes });
}

export function clearSketch(): void {
  redoStack = [];
  set({ strokes: [] });
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
