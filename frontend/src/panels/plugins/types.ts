import type { components } from "../../api/generated";

/**
 * Plugin shapes come straight from the backend's OpenAPI schema — the panels
 * must not hand-roll them or they drift from the Pydantic models.
 *
 * A plugin carries where it was found on netlab's search path (`origin`,
 * `source`), what it declares (`requires`, `execute_after`, `hooks`), and any
 * same-id copies netlab will ignore (`shadows`).
 */
export type PluginInfo = components["schemas"]["Plugin"];
export type PluginPipelineEntry = components["schemas"]["PluginPipelineEntry"];
export type PluginPipelineInfo = components["schemas"]["PluginPipeline"];

export type PluginDocsView = "markdown" | "web";

/** Builtins ship with netlab; everything else is the user's own plugin. */
export function isCustomPlugin(plugin: PluginInfo): boolean {
  return !!plugin.origin && plugin.origin !== "builtin";
}

export const ORIGIN_LABELS: Record<string, string> = {
  topology: "Lab folder",
  user: "~/.netlab",
  system: "/etc/netlab",
  builtin: "netlab",
};
