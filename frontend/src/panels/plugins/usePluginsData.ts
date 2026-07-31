import { useCallback, useEffect, useMemo, useState } from "react";
import { parse } from "yaml";
import { api } from "../../api/client";
import { isCustomPlugin, type PluginInfo, type PluginPipelineInfo } from "./types";
import { togglePluginInYaml } from "./pluginYaml";

/** Owns the topology YAML, the plugin catalog, and the derived enabled/pipeline
 * state for the Plugins panel. Self-fetches the current YAML from the snapshot
 * so this panel doesn't depend on App's snapshot state. */
export function usePluginsData(sessionId: string, base: string, onChanged: () => void, searchQuery: string) {
  const [yaml, setYaml] = useState("");
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PluginPipelineInfo | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`${base}/api/topology/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((snap) => { if (snap?.snapshot?.yamlContent) setYaml(snap.snapshot.yamlContent); })
      .catch(() => { });
  }, [sessionId, base]);

  // Load plugins from the backend. Keyed on the session: the topology's own
  // directory is first on netlab's plugin search path, so a plugin sitting
  // next to the lab file only shows up once the session is known.
  const loadPlugins = useCallback(() => {
    return api.getPlugins(sessionId)
      .then(async (data) => {
        setPlugins(data);
        setError(null);
        setDebug(null);
        if (data.length === 0) {
          try {
            const details = await api.getPluginDebug(sessionId);
            setDebug(`backend returned 0 plugins from ${JSON.stringify(details.discovery)}`);
          } catch (debugErr) {
            setDebug(`backend returned 0 plugins and /api/plugins/debug failed: ${String(debugErr)}`);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load plugins:", err);
        setError(String(err));
        setLoading(false);
      });
  }, [sessionId]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  // Parse active plugins from the current YAML document
  const activePlugins = useMemo(() => {
    try {
      const doc = parse(yaml);
      if (doc && Array.isArray(doc.plugin)) return doc.plugin as string[];
      if (doc && typeof doc.plugin === "string") return [doc.plugin];
    } catch {
      // Ignore YAML parse errors during drafting
    }
    return [];
  }, [yaml]);

  // Resolve the execution order whenever the enabled set changes. The backend
  // applies netlab's own dependency sort, so this is the order `netlab up`
  // will use — not the order in the file.
  const activePluginsKey = activePlugins.join(" ");
  useEffect(() => {
    if (activePlugins.length === 0) {
      setPipeline(null);
      return;
    }
    let cancelled = false;
    api.getPluginPipeline(activePlugins, sessionId)
      .then((data) => { if (!cancelled) setPipeline(data); })
      .catch(() => { if (!cancelled) setPipeline(null); });
    return () => { cancelled = true; };
    // activePluginsKey stands in for the array identity, which changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePluginsKey, sessionId]);

  const filteredPlugins = useMemo(() => {
    if (!searchQuery.trim()) {
      return plugins;
    }
    const query = searchQuery.toLowerCase();
    return plugins.filter(
      (plugin) =>
        plugin.id.toLowerCase().includes(query) ||
        plugin.title.toLowerCase().includes(query)
    );
  }, [plugins, searchQuery]);

  // Custom plugins first — they're the ones the user is iterating on, and
  // there are a handful of them against ~25 builtins.
  const customPlugins = useMemo(() => filteredPlugins.filter(isCustomPlugin), [filteredPlugins]);
  const builtinPlugins = useMemo(() => filteredPlugins.filter((p) => !isCustomPlugin(p)), [filteredPlugins]);

  const handleTogglePlugin = useCallback(async (pluginId: string, enabled: boolean) => {
    try {
      const newYaml = togglePluginInYaml(yaml, pluginId, enabled);
      await api.putModelYaml(sessionId, newYaml);
      setYaml(newYaml);
      onChanged();
    } catch (e) {
      console.error("Failed to toggle plugin in YAML:", e);
    }
  }, [yaml, sessionId, onChanged]);

  return {
    plugins,
    setPlugins,
    loading,
    error,
    debug,
    pipeline,
    activePlugins,
    filteredPlugins,
    customPlugins,
    builtinPlugins,
    loadPlugins,
    handleTogglePlugin,
  };
}
