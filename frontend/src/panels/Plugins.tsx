import { useState } from "react";
import { Alert, Box, Button, CircularProgress, Divider, List } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { getApiBase } from "../api/endpoint";
import { MarkdownDocumentDialog } from "../components/MarkdownDocumentDialog";
import { PluginPipelineStrip } from "./plugins/PluginPipelineStrip";
import { PluginImportDialog } from "./plugins/PluginImportDialog";
import { PluginSection } from "./plugins/PluginSection";
import { PluginSearchField } from "./plugins/PluginSearchField";
import { PluginCatalogStatus } from "./plugins/PluginCatalogStatus";
import { PluginListEmptyState } from "./plugins/PluginListEmptyState";
import { GeneratorsSection } from "./plugins/GeneratorsSection";
import { usePluginDocs } from "./plugins/usePluginDocs";
import { usePluginsData } from "./plugins/usePluginsData";

export function PluginsPanel({
  sessionId,
  onChanged
}: {
  sessionId: string;
  onChanged: () => void;
}) {
  const BASE = getApiBase();
  const [searchQuery, setSearchQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const {
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
    reloadYaml,
    yaml,
    handleTogglePlugin,
  } = usePluginsData(sessionId, BASE, onChanged, searchQuery);

  const {
    activePluginDocs,
    activePluginDocsView,
    expandedPlugin,
    loadingPluginReference,
    extractedTitle,
    processedMarkdown,
    resolvePluginImageFallback,
    handleOpenPluginDocs,
    handlePluginReferenceChange,
    closeDocs,
  } = usePluginDocs(sessionId, BASE, setPlugins);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>

      <Divider />

      {pipeline && <PluginPipelineStrip pipeline={pipeline} />}

      <GeneratorsSection
        sessionId={sessionId}
        topologyKey={yaml}
        onApplied={(message) => {
          setImportNotice(message);
          void reloadYaml();
          onChanged();
        }}
      />

      {/* netlab has always supported user-written plugins; without a visible
          entry point nobody discovers that the built-in list isn't the limit. */}
      <Button
        size="small"
        variant="outlined"
        startIcon={<AddIcon sx={{ fontSize: 16 }} />}
        onClick={() => setImportOpen(true)}
        sx={{ alignSelf: "flex-start", fontSize: "0.75rem", py: 0.25 }}
      >
        Add custom plugin
      </Button>

      {importNotice && (
        <Alert severity="info" onClose={() => setImportNotice(null)} sx={{ py: 0.25, fontSize: "0.75rem" }}>
          {importNotice}
        </Alert>
      )}

      <PluginSearchField value={searchQuery} onChange={setSearchQuery} />

      <PluginCatalogStatus
        error={error}
        debug={debug}
        totalCount={plugins.length}
        filteredCount={filteredPlugins.length}
        customCount={customPlugins.length}
        searchActive={Boolean(searchQuery.trim())}
      />

      <List disablePadding sx={{ width: "100%" }}>
        <PluginSection
          heading="Custom plugins"
          group={customPlugins}
          showHeading={builtinPlugins.length > 0}
          activePlugins={activePlugins}
          expandedPlugin={expandedPlugin}
          loadingPluginReference={loadingPluginReference}
          onToggleEnabled={(plugin, enabled) => void handleTogglePlugin(plugin.id, enabled)}
          onExpandedChange={(plugin, expanded) => void handlePluginReferenceChange(plugin, expanded)}
          onOpenDocs={(plugin, view) => void handleOpenPluginDocs(plugin, view)}
        />
        <PluginSection
          heading="Installed with netlab"
          group={builtinPlugins}
          showHeading={customPlugins.length > 0}
          activePlugins={activePlugins}
          expandedPlugin={expandedPlugin}
          loadingPluginReference={loadingPluginReference}
          onToggleEnabled={(plugin, enabled) => void handleTogglePlugin(plugin.id, enabled)}
          onExpandedChange={(plugin, expanded) => void handlePluginReferenceChange(plugin, expanded)}
          onOpenDocs={(plugin, view) => void handleOpenPluginDocs(plugin, view)}
        />
        <PluginListEmptyState error={error} totalCount={plugins.length} filteredCount={filteredPlugins.length} />
      </List>

      <PluginImportDialog
        open={importOpen}
        sessionId={sessionId}
        hasOpenLab={!!sessionId}
        onClose={() => setImportOpen(false)}
        onImported={(result) => {
          // Enable it straight away — importing a plugin you then have to
          // hunt down and tick is a pointless second step.
          void handleTogglePlugin(result.plugin.id, true);
          void loadPlugins();
          setImportNotice(
            [`Added ${result.plugin.id} (${result.path}) and enabled it.`, ...(result.warnings ?? [])].join(" ")
          );
        }}
      />

      <MarkdownDocumentDialog
        open={activePluginDocs !== null}
        title={extractedTitle || `${activePluginDocs?.id} plugin manual`}
        subtitle="Plugin documentation"
        markdown={processedMarkdown}
        resolveImageFallback={resolvePluginImageFallback}
        webUrl={activePluginDocs?.docs_url}
        initialView={activePluginDocsView}
        fillViewport
        onClose={closeDocs}
      />
    </Box>
  );
}
