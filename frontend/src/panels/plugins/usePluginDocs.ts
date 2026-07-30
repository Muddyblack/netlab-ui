import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../../api/client";
import type { PluginDocsView, PluginInfo } from "./types";
import { rewritePluginImageLinks } from "./pluginYaml";

/** Owns the plugin-documentation dialog and reference-accordion state. The
 * list endpoint returns plugins without markdown (it stays local + fast);
 * this resolves a plugin's manual lazily the first time it's opened, then
 * caches it back into the shared plugin list so reopening is instant. */
export function usePluginDocs(sessionId: string, base: string, setPlugins: Dispatch<SetStateAction<PluginInfo[]>>) {
  const [activePluginDocs, setActivePluginDocs] = useState<PluginInfo | null>(null);
  const [activePluginDocsView, setActivePluginDocsView] = useState<PluginDocsView>("markdown");
  const [expandedPlugin, setExpandedPlugin] = useState<string | false>(false);
  const [loadingPluginReference, setLoadingPluginReference] = useState<string | null>(null);

  const loadPluginDocumentation = useCallback(async (plugin: PluginInfo): Promise<PluginInfo> => {
    if (plugin.markdown) return plugin;
    const full = await api.getPluginDoc(plugin.id, sessionId);
    setPlugins((prev) => prev.map((entry) => (entry.id === full.id ? { ...entry, ...full } : entry)));
    return full;
  }, [sessionId, setPlugins]);

  const handleOpenPluginDocs = useCallback(async (plugin: PluginInfo, initialView: PluginDocsView) => {
    setActivePluginDocsView(initialView);
    if (plugin.markdown) {
      setActivePluginDocs(plugin);
      return;
    }
    setActivePluginDocs({ ...plugin, markdown: "Loading documentation…" });
    try {
      const full = await loadPluginDocumentation(plugin);
      setActivePluginDocs(full);
    } catch (err) {
      setActivePluginDocs({
        ...plugin,
        markdown: `# ${plugin.id}\n\nFailed to load documentation: ${String(err)}`,
      });
    }
  }, [loadPluginDocumentation]);

  const handlePluginReferenceChange = useCallback(async (plugin: PluginInfo, expanded: boolean) => {
    setExpandedPlugin(expanded ? plugin.id : false);
    if (!expanded || plugin.markdown) return;

    setLoadingPluginReference(plugin.id);
    try {
      await loadPluginDocumentation(plugin);
    } catch (err) {
      console.error(`Failed to load ${plugin.id} plugin reference:`, err);
    } finally {
      setLoadingPluginReference(null);
    }
  }, [loadPluginDocumentation]);

  const extractedTitle = useMemo(() => {
    if (!activePluginDocs?.markdown) return null;
    const match = activePluginDocs.markdown.match(/^#\s+(.+)$/m);
    return match ? match[1] : null;
  }, [activePluginDocs?.markdown]);

  const processedMarkdown = useMemo(() => {
    if (!activePluginDocs?.markdown) return "";
    return rewritePluginImageLinks(activePluginDocs.markdown, base);
  }, [activePluginDocs?.markdown, base]);

  const resolvePluginImageFallback = useCallback(
    (src: string): string | undefined => {
      const localPrefix = `${base}/api/plugins/images/`;
      if (!src.startsWith(localPrefix)) return undefined;
      return `https://netlab.tools/_images/${src.slice(localPrefix.length)}`;
    },
    [base]
  );

  return {
    activePluginDocs,
    activePluginDocsView,
    expandedPlugin,
    loadingPluginReference,
    extractedTitle,
    processedMarkdown,
    resolvePluginImageFallback,
    handleOpenPluginDocs,
    handlePluginReferenceChange,
    closeDocs: () => setActivePluginDocs(null),
  };
}
