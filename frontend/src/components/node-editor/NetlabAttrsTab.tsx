import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ComponentType } from "react";
import { useNodes, type NodeEditorTabProps } from "@containerlab/clab-ui";
import { getApiBase } from "../../api/endpoint";
import { useNodeEditorSession } from "./NodeEditorSessionContext";

/**
 * clab-ui's node editor models containerlab fields only: it builds the form
 * from a fixed set of containerlab properties and saves (and dirty-checks)
 * only those. netlab attributes edited in our tabs — role, provider, box,
 * module, config, module settings, custom attributes — were therefore never
 * shown with their current value and silently dropped on save.
 *
 * This wrapper closes both gaps without touching clab-ui:
 *  - read: overlays the node's declared netlab attributes (the snapshot
 *    stashes them under `extraData.netlabAttrs`) under the form data;
 *  - write: sends changed netlab-only keys straight to the backend's
 *    `editNode` command (undoable like any canvas edit) and refreshes.
 */

/** Editor fields clab-ui converts and saves itself (see its
 * nodeEditorConversions); everything else a netlab tab changes is ours. */
const CLAB_EDITOR_KEYS = new Set([
  "id", "name", "kind", "type", "image", "group", "icon", "iconColor", "iconCornerRadius",
  "labelPosition", "direction", "labelBackgroundColor", "interfacePattern", "customName", "baseName",
  "startupConfig", "enforceStartupConfig", "suppressStartupConfig", "license", "binds", "env", "envFiles",
  "labels", "user", "entrypoint", "cmd", "exec", "restartPolicy", "autoRemove", "startupDelay",
  "mgmtIpv4", "mgmtIpv6", "networkMode", "ports", "dnsServers", "aliases", "cpu", "cpuSet", "memory",
  "shmSize", "capAdd", "sysctls", "devices", "imagePullPolicy", "runtime", "certIssue", "certKeySize",
  "certValidity", "sans", "healthCheck", "healthcheck", "components", "extraData",
]);

const SAVE_DEBOUNCE_MS = 400;

/** Called after netlab attributes were written, to refresh the canvas. */
const NetlabAttrsSavedContext = createContext<(() => void) | null>(null);
export const NetlabAttrsSavedProvider = NetlabAttrsSavedContext.Provider;

function storedNetlabAttrs(nodes: ReturnType<typeof useNodes>, nodeId: unknown): Record<string, unknown> {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const extra = (node?.data as { extraData?: { netlabAttrs?: unknown } } | undefined)?.extraData;
  const attrs = extra?.netlabAttrs;
  return attrs && typeof attrs === "object" && !Array.isArray(attrs) ? (attrs as Record<string, unknown>) : {};
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function withNetlabAttrs(Tab: ComponentType<NodeEditorTabProps>): ComponentType<NodeEditorTabProps> {
  function NetlabAttrsTab(props: NodeEditorTabProps) {
    const { data, onChange } = props;
    const sessionId = useNodeEditorSession();
    const onSaved = useContext(NetlabAttrsSavedContext);
    const nodes = useNodes();
    const nodeId = (data as { id?: unknown }).id;
    const stored = useMemo(() => storedNetlabAttrs(nodes, nodeId), [nodes, nodeId]);
    const merged = useMemo(() => ({ ...stored, ...(data as unknown as Record<string, unknown>) }), [stored, data]);

    const pending = useRef<Record<string, unknown>>({});
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const target = useRef({ sessionId, nodeId, onSaved });
    target.current = { sessionId, nodeId, onSaved };

    const flush = useCallback(() => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const updates = pending.current;
      pending.current = {};
      const { sessionId: sid, nodeId: id, onSaved: saved } = target.current;
      if (!sid || typeof id !== "string" || Object.keys(updates).length === 0) return;
      // undefined is dropped by JSON; the backend removes attributes sent as null.
      const extraData = Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v === undefined ? null : v]));
      void fetch(`${getApiBase()}/api/topology/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, command: { command: "editNode", payload: { id, extraData } } }),
      })
        .then(() => saved?.())
        .catch((err) => console.error("Failed to save netlab node attributes:", err));
    }, []);

    // Don't lose a pending edit when the editor closes or switches node.
    useEffect(() => () => flush(), [flush, nodeId]);

    const handleChange = useCallback((updates: Record<string, unknown>) => {
      onChange(updates);
      let changed = false;
      for (const [key, value] of Object.entries(updates)) {
        if (!key || CLAB_EDITOR_KEYS.has(key) || same(value, merged[key])) continue;
        pending.current[key] = value;
        changed = true;
      }
      if (!changed) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }, [flush, merged, onChange]);

    return <Tab {...props} data={merged as unknown as NodeEditorTabProps["data"]} onChange={handleChange as NodeEditorTabProps["onChange"]} />;
  }
  NetlabAttrsTab.displayName = `withNetlabAttrs(${Tab.displayName ?? Tab.name ?? "Tab"})`;
  return NetlabAttrsTab;
}
