import { Typography } from "@mui/material";
import type { PluginDocsView, PluginInfo } from "./types";
import { PluginCard } from "./PluginCard";

interface PluginSectionProps {
  heading: string;
  group: PluginInfo[];
  showHeading: boolean;
  activePlugins: string[];
  expandedPlugin: string | false;
  loadingPluginReference: string | null;
  onToggleEnabled: (plugin: PluginInfo, enabled: boolean) => void;
  onExpandedChange: (plugin: PluginInfo, expanded: boolean) => void;
  onOpenDocs: (plugin: PluginInfo, view: PluginDocsView) => void;
}

/** Only worth a heading when both groups are on screen; a lone group would
 * just be a label over the whole list. */
export function PluginSection({
  heading,
  group,
  showHeading,
  activePlugins,
  expandedPlugin,
  loadingPluginReference,
  onToggleEnabled,
  onExpandedChange,
  onOpenDocs,
}: PluginSectionProps) {
  if (group.length === 0) return null;
  return (
    <>
      {showHeading && (
        <Typography
          variant="caption"
          sx={{ display: "block", fontWeight: 700, color: "text.secondary", mt: 1, mb: 0.5, px: 0.25 }}
        >
          {heading} ({group.length})
        </Typography>
      )}
      {group.map((plugin) => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          isEnabled={activePlugins.includes(plugin.id)}
          isExpanded={expandedPlugin === plugin.id}
          isLoadingReference={loadingPluginReference === plugin.id}
          onToggleEnabled={(enabled) => onToggleEnabled(plugin, enabled)}
          onExpandedChange={(expanded) => onExpandedChange(plugin, expanded)}
          onOpenDocs={(view) => onOpenDocs(plugin, view)}
        />
      ))}
    </>
  );
}
