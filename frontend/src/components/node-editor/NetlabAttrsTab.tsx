import { useCallback, useMemo, type ComponentType } from "react";
import type { NodeEditorTabProps } from "@containerlab/clab-ui";

/**
 * clab-ui's node editor models containerlab fields only. netlab attributes
 * (role, provider, box, module, config, module settings, custom attributes)
 * travel in its host-owned field bag instead — `hostFields`, added by
 * patches/@containerlab+clab-ui+*+editor-host-fields.patch: the snapshot fills
 * it with the node's declared netlab attributes, clab-ui loads it into the
 * form, dirty-checks it, and sends it back with `editNode` on Apply.
 *
 * The netlab tabs are written against flat fields (`data.role`,
 * `onChange({ module })`); this wrapper maps those onto `hostFields` and
 * leaves clab-ui's own fields to clab-ui.
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
  "certValidity", "sans", "healthCheck", "healthcheck", "components", "extraData", "hostFields",
]);

type FieldBag = Record<string, unknown>;

export function withNetlabAttrs(Tab: ComponentType<NodeEditorTabProps>): ComponentType<NodeEditorTabProps> {
  function NetlabAttrsTab(props: NodeEditorTabProps) {
    const { data, onChange } = props;
    const editor = data as unknown as FieldBag;
    const hostFields = useMemo(() => (editor.hostFields as FieldBag | undefined) ?? {}, [editor.hostFields]);
    const merged = useMemo(() => ({ ...hostFields, ...editor }), [hostFields, editor]);

    const handleChange = useCallback((updates: FieldBag) => {
      const clabUpdates: FieldBag = {};
      let nextHost: FieldBag | null = null;
      for (const [key, value] of Object.entries(updates)) {
        if (!key) continue;
        if (CLAB_EDITOR_KEYS.has(key)) {
          clabUpdates[key] = value;
          continue;
        }
        nextHost ??= { ...hostFields };
        if (value === undefined || value === null || value === "") delete nextHost[key];
        else nextHost[key] = value;
      }
      // Device is both: clab-ui's kind drives the icon/palette, netlab's
      // device is what gets written.
      if ("kind" in updates && typeof updates.device === "string") {
        nextHost ??= { ...hostFields };
        nextHost.device = updates.device;
      }
      onChange((nextHost ? { ...clabUpdates, hostFields: nextHost } : clabUpdates) as never);
    }, [hostFields, onChange]);

    return <Tab {...props} data={merged as unknown as NodeEditorTabProps["data"]} onChange={handleChange as NodeEditorTabProps["onChange"]} />;
  }
  NetlabAttrsTab.displayName = `withNetlabAttrs(${Tab.displayName ?? Tab.name ?? "Tab"})`;
  return NetlabAttrsTab;
}
