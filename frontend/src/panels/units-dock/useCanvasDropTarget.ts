import { useEffect } from "react";

/** MIME type for dragging a unit from the dock onto the canvas. Unknown to
 * clab-ui's drop pipeline, so it ignores the drag and we handle it ourselves. */
export const UNIT_DRAG_MIME = "application/x-netlab-unit";

/** Canvas drop target: clab-ui's canvas only accepts its own payload types,
 * so we listen in capture phase and claim drags carrying our MIME type. The
 * pane gets a dashed highlight while a unit drag is over it. */
export function useCanvasDropTarget(
  instantiateAt: (unitName: string, origin: { x: number; y: number }) => void,
  isLocked: boolean
) {
  useEffect(() => {
    if (isLocked) return;
    const isUnitDrag = (e: DragEvent) => e.dataTransfer?.types.includes(UNIT_DRAG_MIME) ?? false;
    const paneOf = (e: DragEvent) =>
      e.target instanceof Element ? (e.target.closest(".react-flow") as HTMLElement | null) : null;

    let highlighted: HTMLElement | null = null;
    const highlight = (pane: HTMLElement | null) => {
      if (highlighted && highlighted !== pane) {
        highlighted.style.outline = "";
        highlighted.style.outlineOffset = "";
      }
      if (pane) {
        pane.style.outline = "3px dashed var(--vscode-focusBorder, #3794ff)";
        pane.style.outlineOffset = "-3px";
      }
      highlighted = pane;
    };

    const onDragOver = (e: DragEvent) => {
      if (!isUnitDrag(e)) return;
      const pane = paneOf(e);
      highlight(pane);
      if (pane) {
        e.preventDefault();
        // Keep clab-ui's canvas onDragOver from running: it overwrites
        // dropEffect with "move", which the browser rejects against our
        // "copy" effectAllowed and then never fires the drop event.
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDragEnd = () => highlight(null);
    const onDrop = (e: DragEvent) => {
      const pane = paneOf(e);
      highlight(null);
      if (!isUnitDrag(e) || !pane) return;
      e.preventDefault();
      e.stopPropagation();
      const name = e.dataTransfer?.getData(UNIT_DRAG_MIME);
      if (!name) return;
      // Screen → flow coordinates via the ReactFlow viewport transform.
      const viewport = pane.querySelector(".react-flow__viewport");
      let origin = { x: 0, y: 0 };
      if (viewport) {
        const rect = pane.getBoundingClientRect();
        const t = new DOMMatrixReadOnly(window.getComputedStyle(viewport).transform);
        origin = {
          x: (e.clientX - rect.left - t.e) / (t.a || 1),
          y: (e.clientY - rect.top - t.f) / (t.d || 1)
        };
      }
      instantiateAt(name, origin);
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      highlight(null);
    };
  }, [instantiateAt, isLocked]);
}
