import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { Box, IconButton, Tooltip } from "@mui/material";
import { blurTrigger } from "../utils/focus";

export interface DocumentationActionButtonsProps {
  docsUrl?: string | null;
  manualLabel: string;
  externalLabel?: string;
  onOpenManual: () => void;
  onOpenExternal?: () => void;
  size?: "small" | "medium" | "large";
}

export function DocumentationActionButtons({
  docsUrl,
  manualLabel,
  externalLabel = "Open external documentation",
  onOpenManual,
  onOpenExternal,
  size = "small"
}: DocumentationActionButtonsProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
      {docsUrl && onOpenExternal ? (
        <Tooltip title={externalLabel}>
          <IconButton
            size={size}
            onClick={(event) => {
              blurTrigger(event.currentTarget);
              onOpenExternal();
            }}
            sx={{ color: "text.secondary" }}
            aria-label={externalLabel}
          >
            <OpenInNewIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      ) : null}
      <Tooltip title={manualLabel}>
        <IconButton
          size={size}
          onClick={(event) => {
            blurTrigger(event.currentTarget);
            onOpenManual();
          }}
          sx={{ color: "text.secondary" }}
          aria-label={manualLabel}
        >
          <InfoOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
