import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Button, Typography } from "@mui/material";
import { api, type DocsDocument } from "../../api/client";
import { DocumentationActionButtons } from "../DocumentationActionButtons";
import { MarkdownDocumentDialog } from "../MarkdownDocumentDialog";
import { EmbeddedDocumentationDialog } from "../EmbeddedDocumentationDialog";

// Kept here (not in lifecycle/types) — that module imports this component for
// the node-editor tab list, so importing back from it is a circular import.
const NETLAB_PLATFORMS_DOCS_URL = "https://netlab.tools/platforms/";
import RotateLeftIcon from "@mui/icons-material/RotateLeft";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SyncAltIcon from "@mui/icons-material/SyncAlt";

import {
  InputField,
  FilterableDropdown,
  IconPreview,
  PanelSection,
  SelectField,
  ColorField,
  IconSelectorModal,
  type NodeEditorTabProps,
  type NodeType,
  generateEncodedSVG,
  DEFAULT_ICON_COLOR
} from "@srl-labs/clab-ui";
import { blurTrigger } from "../../utils/focus";
import type { NetlabNodeEditorData, NetlabOnChange } from "./types";

// Module-level cache so we only hit /api/schema/devices once per session and
// every open node/template editor shares the same complete netlab device list.
let _deviceCache: Array<{ value: string; label: string }> | null = null;

const DEVICE_FALLBACK: Array<{ value: string; label: string }> = [
  { value: "", label: "Inherited / Default" }
];

const ROLE_OPTIONS = [
  { value: "", label: "None / Default" },
  { value: "router", label: "Router" },
  { value: "host", label: "Host" },
  { value: "bridge", label: "Bridge" },
  { value: "gateway", label: "Gateway" },
  { value: "switch", label: "Switch" }
];

const PROVIDER_OPTIONS = [
  { value: "", label: "Inherited / Default" },
  { value: "clab", label: "Containerlab (clab)" },
  { value: "libvirt", label: "libvirt" },
  { value: "virtualbox", label: "VirtualBox" }
];

const NODE_LABEL_POSITION_OPTIONS = [
  { value: "bottom", label: "Bottom" },
  { value: "top", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

const NODE_DIRECTION_OPTIONS = [
  { value: "right", label: "Horizontal", icon: <SwapHorizIcon fontSize="small" /> },
  { value: "down", label: "Rotate text 90deg", icon: <RotateRightIcon fontSize="small" /> },
  { value: "left", label: "Rotate text 180deg", icon: <SyncAltIcon fontSize="small" /> },
  { value: "up", label: "Rotate text 270deg", icon: <RotateLeftIcon fontSize="small" /> }
];

const BUILTIN_NODE_TYPES = new Set([
  "pe", "dcgw", "leaf", "switch", "bridge", "spine", "super-spine", "server", "pon", "controller", "rgw", "ue", "cloud", "client"
]);

function isNodeType(icon: string): icon is NodeType {
  return BUILTIN_NODE_TYPES.has(icon);
}

function getIconSrc(icon: string, color: string): string {
  const nodeType: NodeType = isNodeType(icon) ? icon : "pe";
  try {
    return generateEncodedSVG(nodeType, color);
  } catch {
    return generateEncodedSVG("pe", color);
  }
}

// Shared with the device cache: fetched once, reused by every editor instance.
let _platformDocsCache: DocsDocument | null = null;

function IdentitySection({ data, onChange }: { data: NetlabNodeEditorData; onChange: NetlabOnChange }) {
  return (
    <PanelSection title="Identity" withTopDivider={false}>
      {data.isCustomTemplate ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <InputField
            id="node-template-name"
            label="Template Name"
            value={data.customName || ""}
            onChange={(value) => onChange({ customName: value })}
            placeholder="e.g. room_station"
          />
          <InputField
            id="node-base-name"
            label="Canvas Base Name"
            value={data.baseName || ""}
            onChange={(value) => onChange({ baseName: value })}
            placeholder="e.g. room-station"
          />
          <InputField
            id="node-interface-pattern"
            label="Interface Pattern"
            value={data.interfacePattern || ""}
            onChange={(value) => onChange({ interfacePattern: value })}
            placeholder="e.g. eth{1}"
          />
        </Box>
      ) : (
        <InputField
          id="node-name"
          label="Node Name"
          value={data.name || ""}
          onChange={(value) => onChange({ name: value })}
        />
      )}
    </PanelSection>
  );
}

function NetlabPropertiesSection({ data, onChange, deviceOptions, setPlatformSiteOpen, handleOpenPlatformDocs }: {
  data: NetlabNodeEditorData;
  onChange: NetlabOnChange;
  deviceOptions: Array<{ value: string; label: string }>;
  setPlatformSiteOpen: (open: boolean) => void;
  handleOpenPlatformDocs: () => void;
}) {
  return (
    <PanelSection title="Netlab Properties">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5 }}>
          <Box sx={{ flexGrow: 1 }}>
            <FilterableDropdown
              id="node-device"
              label="Device Type"
              options={deviceOptions}
              value={data.device || data.kind || ""}
              onChange={(value) => onChange({ device: value, kind: value })}
              placeholder="Select or type device..."
              allowFreeText={true}
            />
          </Box>
          <DocumentationActionButtons
            docsUrl={NETLAB_PLATFORMS_DOCS_URL}
            externalLabel="Open supported platforms docs"
            manualLabel="Open supported platforms reference"
            onOpenExternal={() => setPlatformSiteOpen(true)}
            onOpenManual={handleOpenPlatformDocs}
          />
        </Box>
        <SelectField
          id="node-role"
          label="Role"
          value={data.role || ""}
          onChange={(value) => onChange({ role: value })}
          options={ROLE_OPTIONS}
        />
        <SelectField
          id="node-provider"
          label="Provider"
          value={data.provider || ""}
          onChange={(value) => onChange({ provider: value })}
          options={PROVIDER_OPTIONS}
        />
        <InputField
          id="node-box"
          label="Box Image"
          value={data.box || ""}
          onChange={(value) => onChange({ box: value })}
          placeholder="e.g. generic/ubuntu2004 or arista/veos"
        />
      </Box>
    </PanelSection>
  );
}

function VisualCanvasSettingsSection({ data, onChange, iconName, iconColor, iconCornerRadius, setIsIconModalOpen, handleLabelBackgroundColorChange }: {
  data: NetlabNodeEditorData;
  onChange: NetlabOnChange;
  iconName: string;
  iconColor: string;
  iconCornerRadius: number;
  setIsIconModalOpen: (open: boolean) => void;
  handleLabelBackgroundColorChange: (color: string) => void;
}) {
  return (
    <PanelSection title="Visual Canvas Settings">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ flexShrink: 0 }}>
            <IconPreview
              src={getIconSrc(iconName, iconColor)}
              alt={iconName}
              size={48}
              cornerRadius={iconCornerRadius}
            />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
              Icon: {iconName}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={(event) => {
                blurTrigger(event.currentTarget);
                setIsIconModalOpen(true);
              }}
            >
              Change Icon
            </Button>
          </Box>
        </Box>

        <SelectField
          id="node-label-position"
          label="Label Position"
          value={data.labelPosition || "bottom"}
          onChange={(value) => onChange({ labelPosition: value })}
          options={NODE_LABEL_POSITION_OPTIONS}
        />

        <SelectField
          id="node-direction"
          label="Label Direction"
          value={data.direction || "right"}
          onChange={(value) => onChange({ direction: value })}
          options={NODE_DIRECTION_OPTIONS}
        />

        <ColorField
          label="Label Background Color"
          value={data.labelBackgroundColor || "rgba(0,0,0,0.7)"}
          onChange={handleLabelBackgroundColorChange}
        />
      </Box>
    </PanelSection>
  );
}

export const NetlabBasicTab: React.FC<NodeEditorTabProps> = ({ data: rawData, onChange: rawOnChange }) => {
  const data = rawData as NetlabNodeEditorData;
  const onChange = rawOnChange as NetlabOnChange;
  const [isIconModalOpen, setIsIconModalOpen] = useState(false);
  const [platformDocsOpen, setPlatformDocsOpen] = useState(false);
  const [platformSiteOpen, setPlatformSiteOpen] = useState(false);
  const [platformDocs, setPlatformDocs] = useState<DocsDocument | null>(_platformDocsCache);
  const [deviceOptions, setDeviceOptions] = useState<Array<{ value: string; label: string }>>(
    () => _deviceCache ?? DEVICE_FALLBACK
  );

  // Load the full netlab device list (same source as the palette "Devices"
  // tab) so the Device Type dropdown is complete and consistent. Free-text is
  // still allowed below, so any device not in the list can be typed directly.
  useEffect(() => {
    if (_deviceCache) {
      setDeviceOptions(_deviceCache);
      return;
    }
    let cancelled = false;
    api
      .getDevices()
      .then((devices) => {
        const opts = [
          { value: "", label: "Inherited / Default" },
          ...devices.map((d) => ({ value: d.kind, label: `${d.label} (${d.kind})` }))
        ];
        _deviceCache = opts;
        if (!cancelled) setDeviceOptions(opts);
      })
      .catch(() => {
        /* keep fallback; free-text entry still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve the Supported Platforms reference lazily the first time its manual
  // is opened; the doc is served (and disk-cached) by the backend.
  const handleOpenPlatformDocs = useCallback(() => {
    setPlatformDocsOpen(true);
    if (_platformDocsCache) return;
    api
      .getDoc("platforms")
      .then((doc) => {
        _platformDocsCache = doc;
        setPlatformDocs(doc);
      })
      .catch(() => {
        /* dialog falls back to the static pointer text below */
      });
  }, []);

  const platformDocsMarkdown = useMemo(
    () =>
      platformDocs?.markdown ??
      `# Supported platforms\n\nSee the [Supported Platforms](${NETLAB_PLATFORMS_DOCS_URL}) reference for provider support, caveats, and platform-specific details.`,
    [platformDocs]
  );

  const iconColor = data.iconColor ?? DEFAULT_ICON_COLOR;
  const iconCornerRadius = data.iconCornerRadius ?? 0;
  const iconName = data.icon || "pe";

  const handleIconSave = useCallback(
    (newIcon: string, newColor: string | null, newRadius: number) => {
      onChange({
        icon: newIcon,
        iconColor: newColor ?? undefined,
        iconCornerRadius: newRadius
      });
    },
    [onChange]
  );

  const handleLabelBackgroundColorChange = useCallback(
    (color: string) => {
      onChange({ labelBackgroundColor: color });
    },
    [onChange]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <IdentitySection data={data} onChange={onChange} />

      <NetlabPropertiesSection
        data={data}
        onChange={onChange}
        deviceOptions={deviceOptions}
        setPlatformSiteOpen={setPlatformSiteOpen}
        handleOpenPlatformDocs={handleOpenPlatformDocs}
      />

      <VisualCanvasSettingsSection
        data={data}
        onChange={onChange}
        iconName={iconName}
        iconColor={iconColor}
        iconCornerRadius={iconCornerRadius}
        setIsIconModalOpen={setIsIconModalOpen}
        handleLabelBackgroundColorChange={handleLabelBackgroundColorChange}
      />

      <MarkdownDocumentDialog
        open={platformDocsOpen}
        title={platformDocs?.title || "Supported platforms"}
        subtitle="Rendered markdown reference"
        markdown={platformDocsMarkdown}
        onClose={() => setPlatformDocsOpen(false)}
      />
      <EmbeddedDocumentationDialog
        open={platformSiteOpen}
        title="Supported Platforms"
        subtitle="Netlab device documentation"
        url={NETLAB_PLATFORMS_DOCS_URL}
        onClose={() => setPlatformSiteOpen(false)}
      />

      {/* Icon Selector Modal */}
      <IconSelectorModal
        isOpen={isIconModalOpen}
        onClose={() => setIsIconModalOpen(false)}
        onSave={handleIconSave}
        initialIcon={iconName}
        initialColor={iconColor}
        initialCornerRadius={iconCornerRadius}
      />
    </Box>
  );
};
