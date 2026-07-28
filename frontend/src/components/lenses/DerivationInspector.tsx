import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import {
  Box,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState } from "react";

import type { DerivationNode } from "../../api/client";
// Blue = authored, Purple = inherited, Green = computed — shared with the canvas
// overlay so the side panel and the on-node provenance never drift apart.
import { ORIGIN_COLOR } from "./lens-canvas-overlay/helpers";

const ORIGIN_LABEL: Record<string, string> = {
  authored: "Authored",
  inherited: "Inherited",
  computed: "Computed",
};

// Copies a field's value and briefly flips to a check so the click is
// acknowledged without a toast. Sits inside a hover-reveal row.
function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be blocked (permissions / insecure context); stay silent.
    }
  };

  return (
    <Tooltip title={copied ? "Copied" : "Copy value"}>
      <IconButton
        size="small"
        onClick={copy}
        aria-label={`Copy ${value}`}
        sx={{ p: 0.25, color: copied ? "success.main" : "text.secondary" }}
      >
        {copied ? <CheckIcon sx={{ fontSize: 15 }} /> : <ContentCopyOutlinedIcon sx={{ fontSize: 15 }} />}
      </IconButton>
    </Tooltip>
  );
}

function OriginBar({ node }: { node: DerivationNode }) {
  const total = node.authored + node.inherited + node.computed || 1;
  const segments = [
    { key: "authored", value: node.authored },
    { key: "inherited", value: node.inherited },
    { key: "computed", value: node.computed },
  ].filter((segment) => segment.value > 0);
  return (
    <Box sx={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", bgcolor: "action.hover" }}>
      {segments.map((segment) => (
        <Tooltip key={segment.key} title={`${ORIGIN_LABEL[segment.key]}: ${segment.value}`}>
          <Box sx={{ width: `${(segment.value / total) * 100}%`, bgcolor: ORIGIN_COLOR[segment.key] }} />
        </Tooltip>
      ))}
    </Box>
  );
}

export function DerivationInspector({ node }: { node: DerivationNode | undefined }) {
  if (!node) return null;

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <AccountTreeOutlinedIcon fontSize="small" color="action" />
        <Typography variant="overline" color="text.secondary">Derivation · {node.node}</Typography>
      </Stack>

      {node.groups.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">groups</Typography>
          {node.groups.map((group) => <Chip key={group} size="small" variant="outlined" label={group} sx={{ height: 20 }} />)}
        </Stack>
      )}

      <OriginBar node={node} />

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {(["authored", "inherited", "computed"] as const).map((origin) => (
          <Stack key={origin} direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: ORIGIN_COLOR[origin] }} />
            <Typography variant="caption" color="text.secondary">{ORIGIN_LABEL[origin]}</Typography>
          </Stack>
        ))}
      </Stack>

      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
        {node.fields.map((field) => (
          <Box
            key={field.path}
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              borderLeft: `3px solid ${ORIGIN_COLOR[field.origin]}`,
              bgcolor: "action.hover",
              // Reveal the copy button on hover/focus to keep the row calm.
              "& .copy-value": { opacity: 0, transition: "opacity 120ms ease" },
              "&:hover .copy-value, &:focus-within .copy-value": { opacity: 1 },
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 92, flexShrink: 0 }}>{field.label}</Typography>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-word" }}>{field.value}</Typography>
              <Typography variant="caption" sx={{ color: ORIGIN_COLOR[field.origin] }}>
                {ORIGIN_LABEL[field.origin]}{field.source ? ` · ${field.source}` : ""}
              </Typography>
            </Box>
            <Box className="copy-value" sx={{ flexShrink: 0, alignSelf: "center" }}>
              <CopyValueButton value={field.value} />
            </Box>
          </Box>
        ))}
        {node.fields.length === 0 && (
          <Typography variant="body2" color="text.secondary">No inspectable attributes on this node.</Typography>
        )}
      </Stack>
    </Stack>
  );
}
