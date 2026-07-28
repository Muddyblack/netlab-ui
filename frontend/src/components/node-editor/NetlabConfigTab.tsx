import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";

import {
  DynamicList,
  PanelAddSection,
  PanelSection,
  type NodeEditorTabProps
} from "@srl-labs/clab-ui";
import { api, type ConfigPreviewResult } from "../../api/client";
import { useNodeEditorSession } from "./NodeEditorSessionContext";
import type { NetlabNodeEditorData, NetlabOnChange } from "./types";
import { resolveThemeMode } from "../../theme";

const GeneratedConfigViewer = lazy(() => import("./GeneratedConfigViewer"));

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) return [value];
  return [];
}

export const NetlabConfigTab: React.FC<NodeEditorTabProps> = ({ data: rawData, onChange: rawOnChange }) => {
  const data = rawData as NetlabNodeEditorData;
  const onChange = rawOnChange as NetlabOnChange;
  const sessionId = useNodeEditorSession();
  const nodeName = String(data.name ?? "");
  const [preview, setPreview] = useState<ConfigPreviewResult | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // config is a list of strings in netlab or a single string. We represent it as an array.
  const configList = useMemo(() => toStringList(data.config), [data.config]);

  // skip_config is a list of modules to skip configuring
  const skipConfigList = useMemo(() => toStringList(data.skip_config), [data.skip_config]);

  const handleAddConfig = useCallback(() => {
    onChange({ config: [...configList, ""] });
  }, [configList, onChange]);

  const handleConfigsChange = useCallback(
    (items: string[]) => {
      onChange({ config: items.length > 0 ? items : undefined });
    },
    [onChange]
  );

  const handleAddSkipConfig = useCallback(() => {
    onChange({ skip_config: [...skipConfigList, ""] });
  }, [skipConfigList, onChange]);

  const handleSkipConfigsChange = useCallback(
    (items: string[]) => {
      onChange({ skip_config: items.length > 0 ? items : undefined });
    },
    [onChange]
  );

  const loadPreview = useCallback(async () => {
    if (!sessionId || !nodeName) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await api.getNodeConfigPreview(sessionId, nodeName);
      setPreview(result);
      setActiveFile((current) => result.files.some((file) => file.path === current) ? current : result.files[0]?.path ?? "");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [nodeName, sessionId]);

  useEffect(() => {
    setPreview(null);
    setActiveFile("");
    setPreviewError(null);
    void loadPreview();
  }, [loadPreview]);

  const selectedPreview = preview?.files.find((file) => file.path === activeFile) ?? preview?.files[0];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {!data.isCustomTemplate && (
        <PanelSection title="Generated configuration preview" withTopDivider={false} bodySx={{ p: 1.5 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Exact files produced by netlab create for {nodeName || "this node"}.
              </Typography>
              <Button
                size="small"
                startIcon={previewLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
                disabled={!sessionId || !nodeName || previewLoading}
                onClick={() => void loadPreview()}
              >
                {preview ? "Regenerate" : "Generate"}
              </Button>
            </Stack>

            {previewError && <Alert severity="error">{previewError}</Alert>}
            {preview?.message && preview.files.length === 0 && <Alert severity="info">{preview.message}</Alert>}

            {preview && preview.files.length > 0 && (
              <>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 0, flex: 1 }}>
                    <InputLabel id="config-preview-file-label">Generated file</InputLabel>
                    <Select
                      labelId="config-preview-file-label"
                      label="Generated file"
                      value={selectedPreview?.path ?? ""}
                      onChange={(event) => setActiveFile(event.target.value)}
                    >
                      {preview.files.map((file) => <MenuItem key={file.path} value={file.path}>{file.path}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <Tooltip title="Copy generated configuration">
                    <span>
                      <IconButton
                        size="small"
                        disabled={!selectedPreview}
                        onClick={() => selectedPreview && void navigator.clipboard.writeText(selectedPreview.content)}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
                <Box sx={{ height: 320, overflow: "hidden", border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Suspense fallback={<Box sx={{ height: "100%", display: "grid", placeItems: "center" }}><CircularProgress size={20} /></Box>}>
                    <GeneratedConfigViewer
                      content={selectedPreview?.content ?? ""}
                      path={selectedPreview?.path ?? ""}
                      theme={resolveThemeMode()}
                    />
                  </Suspense>
                </Box>
              </>
            )}
          </Stack>
        </PanelSection>
      )}

      {/* Configuration Templates Section */}
      <PanelAddSection title="Configuration Templates" onAdd={handleAddConfig} withTopDivider={Boolean(!data.isCustomTemplate)}>
        <DynamicList
          items={configList}
          onChange={handleConfigsChange}
          placeholder="Path to netlab config template (e.g. templates/bgp-policy.j2)"
          hideAddButton
        />
      </PanelAddSection>

      {/* Skip Config Modules Section */}
      <PanelAddSection title="Skip Configuration Modules" onAdd={handleAddSkipConfig}>
        <DynamicList
          items={skipConfigList}
          onChange={handleSkipConfigsChange}
          placeholder="Module name to skip (e.g. ospf, bgp)"
          hideAddButton
        />
      </PanelAddSection>
    </Box>
  );
};
