import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { persistAgentPlacement, readAgentPlacement, type AgentPlacement } from "./preferences";

/**
 * Where an agent's terminal is shown, and what is running.
 *
 * A terminal is a live process behind a WebSocket, so it must not be unmounted when it moves or when the
 * AI agents tab is not the visible one. Each one therefore lives in its own DOM element (a "holder") that
 * is rendered once, by the session dock, through a portal. A *slot* (in the dock, or in the AI agents tab)
 * adopts the holder by appending it to itself; a slot that goes away parks it in a hidden element. Moving
 * the holder between slots keeps the xterm instance and its connection untouched.
 */

interface Surface {
  placement: AgentPlacement;
  /** The agent whose terminal the AI agents tab shows (placement "here"). */
  focused: string | null;
  /** Agents with a terminal open for the current lab. */
  running: readonly string[];
}

let surface: Surface = { placement: readAgentPlacement(), focused: null, running: [] };
const listeners = new Set<() => void>();

function update(patch: Partial<Surface>): void {
  surface = { ...surface, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useAgentSurface = (): Surface => useSyncExternalStore(subscribe, () => surface);

export function setAgentPlacement(placement: AgentPlacement): void {
  persistAgentPlacement(placement);
  update({ placement });
}

export const focusAgent = (agentId: string | null): void => update({ focused: agentId });

export function setRunningAgents(ids: readonly string[]): void {
  if (ids.length === surface.running.length && ids.every((id, index) => id === surface.running[index])) return;
  update({ running: ids });
}

// ----------------------------------------------------------------------------- holders

const holders = new Map<string, { element: HTMLDivElement; users: number }>();
let parking: HTMLDivElement | null = null;

function parkingLot(): HTMLDivElement {
  if (!parking) {
    parking = document.createElement("div");
    parking.style.display = "none";
    document.body.appendChild(parking);
  }
  return parking;
}

function holderFor(key: string): HTMLDivElement {
  let entry = holders.get(key);
  if (!entry) {
    const element = document.createElement("div");
    element.style.cssText = "width:100%;height:100%;";
    parkingLot().appendChild(element);
    entry = { element, users: 0 };
    holders.set(key, entry);
  }
  return entry.element;
}

/** Renders ``children`` (a terminal) into the holder for ``holderKey``, wherever that is currently shown. */
export function TerminalHost({ holderKey, children }: { holderKey: string; children: ReactNode }) {
  const element = holderFor(holderKey);
  useEffect(() => {
    const entry = holders.get(holderKey);
    if (entry) entry.users += 1;
    return () => {
      const current = holders.get(holderKey);
      if (!current) return;
      current.users -= 1;
      // Deferred, so a remount in the same tick (React's strict mode) keeps the terminal.
      queueMicrotask(() => {
        if (current.users <= 0 && holders.get(holderKey) === current) {
          holders.delete(holderKey);
          current.element.remove();
        }
      });
    };
  }, [holderKey]);
  return createPortal(children, element);
}

/** An empty area that shows the terminal for ``holderKey``; only one slot should ask for a key at a time. */
export function TerminalSlot({ holderKey }: { holderKey: string }) {
  const slot = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const target = slot.current;
    if (!target) return undefined;
    const element = holderFor(holderKey);
    target.appendChild(element);
    return () => {
      // A new slot adopting the same holder in this commit runs after this, so it wins.
      if (element.parentElement === target) parkingLot().appendChild(element);
    };
  }, [holderKey]);
  return <div ref={slot} style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}
