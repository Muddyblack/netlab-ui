import { Accordion, AccordionDetails, AccordionSummary, Box, Checkbox, Chip, CircularProgress, Tooltip, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

import { DocumentationActionButtons } from "../../components/DocumentationActionButtons";
import { documentedPluginArguments } from "./yamlHelpers";
import { ORIGIN_LABELS, isCustomPlugin, type PluginDocsView, type PluginInfo } from "./types";

function ChipRow({
  label,
  values,
  color,
}: {
  label: string;
  values: string[];
  color?: "warning";
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, minWidth: 52 }}>
        {label}
      </Typography>
      {values.map((value) => (
        <Chip
          key={value}
          label={value}
          size="small"
          color={color}
          variant="outlined"
          sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.7 } }}
        />
      ))}
    </Box>
  );
}

interface PluginCardProps {
  plugin: PluginInfo;
  isEnabled: boolean;
  isExpanded: boolean;
  isLoadingReference: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onExpandedChange: (expanded: boolean) => void;
  onOpenDocs: (view: PluginDocsView) => void;
}

export function PluginCard({
  plugin,
  isEnabled,
  isExpanded,
  isLoadingReference,
  onToggleEnabled,
  onExpandedChange,
  onOpenDocs,
}: PluginCardProps) {
  const argumentsList = documentedPluginArguments(plugin.markdown);
  const isCustom = isCustomPlugin(plugin);
  // Builtins are self-evident; a custom plugin's provenance is the thing the
  // user actually needs (which file on disk is netlab going to load?).
  const originLabel = isCustom ? ORIGIN_LABELS[plugin.origin ?? ""] ?? plugin.origin : null;
  const hooks = plugin.hooks ?? [];
  const requires = plugin.requires ?? [];
  const executeAfter = plugin.execute_after ?? [];
  const shadows = plugin.shadows ?? [];
  // A custom plugin has no upstream manual, so the docstring is all the
  // summary there is.
  const subtitle = plugin.description || plugin.title;
  let borderColor = "divider";
  if (isExpanded) borderColor = "primary.main";
  if (plugin.error) borderColor = "error.main";

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={isExpanded}
      onChange={(_, expanded) => onExpandedChange(expanded)}
      sx={{
        border: "1px solid",
        borderColor,
        borderRadius: "8px !important",
        overflow: "hidden",
        "&:before": { display: "none" },
        "&.Mui-expanded": { my: 0 }
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        sx={{
          px: 1,
          minHeight: 48,
          "& .MuiAccordionSummary-content": {
            my: 0.5,
            alignItems: "center",
            minWidth: 0,
            mr: 1,
            display: "flex",
            justifyContent: "space-between",
          },
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", minWidth: 0, flexGrow: 1, gap: 0.5, mr: 1 }}>
          <Checkbox
            checked={isEnabled}
            onClick={(event) => event.stopPropagation()}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            size="small"
            sx={{ p: 0.5, flexShrink: 0 }}
          />
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{ minWidth: 0, flexGrow: 1, cursor: "pointer" }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "0.85rem" }}>
                {plugin.id}
              </Typography>
              {plugin.error && (
                <Tooltip title={plugin.error}>
                  <ErrorOutlineIcon sx={{ fontSize: 15, color: "error.main" }} />
                </Tooltip>
              )}
              {originLabel && (
                <Tooltip title={plugin.source ?? ""}>
                  <Chip
                    label={originLabel}
                    size="small"
                    color="secondary"
                    variant="outlined"
                    sx={{ height: 17, fontSize: "0.63rem", "& .MuiChip-label": { px: 0.65 } }}
                  />
                </Tooltip>
              )}
            </Box>
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
                fontSize: "0.75rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {subtitle}
            </Typography>
          </Box>
        </Box>
        <Box onClick={(event) => event.stopPropagation()} sx={{ flexShrink: 0 }}>
          <DocumentationActionButtons
            docsUrl={plugin.docs_url}
            externalLabel={`Open ${plugin.id} netlab docs`}
            manualLabel={`Open ${plugin.id} plugin docs`}
            onOpenExternal={() => onOpenDocs("web")}
            onOpenManual={() => onOpenDocs("markdown")}
          />
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, pb: 1.25, px: 1.5 }}>
        {plugin.error && (
          <Typography variant="caption" sx={{ display: "block", color: "error.main", mb: 1 }}>
            netlab will fail to load this plugin: {plugin.error}
          </Typography>
        )}

        {/* Where and when this plugin runs. netlab reorders `plugin:` by these
            dependencies, so the list order in the file is not the run order. */}
        {(hooks.length > 0 || requires.length > 0 || executeAfter.length > 0) && (
          <Box sx={{ display: "grid", gap: 0.5, mb: 1 }}>
            {hooks.length > 0 && (
              <ChipRow label="Runs at" values={hooks} />
            )}
            {requires.length > 0 && (
              <ChipRow label="Requires" values={requires} color="warning" />
            )}
            {executeAfter.length > 0 && (
              <ChipRow label="After" values={executeAfter} />
            )}
          </Box>
        )}

        {shadows.length > 0 && (
          <Typography variant="caption" sx={{ display: "block", color: "warning.main", mb: 1 }}>
            netlab loads {plugin.source} and ignores {shadows.length} other cop
            {shadows.length === 1 ? "y" : "ies"}: {shadows.join(", ")}
          </Typography>
        )}

        <Typography variant="caption" sx={{ display: "block", fontWeight: 700, color: "text.secondary", mb: 0.75 }}>
          Arguments, values & defaults
        </Typography>
        {isLoadingReference && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">Loading plugin reference…</Typography>
          </Box>
        )}
        {!isLoadingReference && argumentsList.length > 0 && (
          <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5 }}>
            {argumentsList.map((argument, index) => (
              <Typography component="li" key={`${plugin.id}-${index}`} variant="caption" sx={{ color: "text.secondary", lineHeight: 1.45 }}>
                {argument}
              </Typography>
            ))}
          </Box>
        )}
        {!isLoadingReference && argumentsList.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {isCustom
              ? "This plugin documents no arguments. Add a README.md next to it to document one here."
              : "This plugin does not document structured arguments or defaults. Open its manual for the complete reference."}
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
