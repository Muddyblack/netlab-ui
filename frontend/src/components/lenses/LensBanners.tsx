import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  Link,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useState } from "react";

import type { LensWarning } from "../../api/client";

// Lens warnings used to sit at the bottom of the panel, below the fold once a
// few pool cards rendered — exactly the wrong place for the most urgent info.
// This banner sits at the top of a lens: a one-line success note when clean, a
// severity-tinted expandable summary when not.
export function LensWarnings({ warnings, noun, emptyText, onSelectRef }: {
  warnings: LensWarning[];
  noun: string;
  emptyText: string;
  onSelectRef: (ref: string) => void;
}) {
  const [open, setOpen] = useState(warnings.length <= 4);
  if (!warnings.length) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <CheckCircleOutlinedIcon sx={{ fontSize: 15 }} color="success" />
        <Typography variant="caption" color="success.main">{emptyText}</Typography>
      </Stack>
    );
  }
  const severity = warnings.some((warning) => warning.severity === "error") ? "error" : "warning";
  const HeaderIcon = severity === "error" ? ErrorOutlineIcon : WarningAmberIcon;
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        borderColor: `${severity}.main`,
        bgcolor: (theme) => alpha(theme.palette[severity].main, 0.08),
      }}
    >
      <ButtonBase
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={{ width: "100%", justifyContent: "flex-start", gap: 0.75, px: 1, py: 0.6 }}
      >
        <HeaderIcon fontSize="small" color={severity} />
        <Typography variant="body2" sx={{ fontWeight: 600, color: `${severity}.main`, flex: 1, textAlign: "left" }}>
          {warnings.length} {noun}{warnings.length === 1 ? "" : "s"}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{ color: `${severity}.main`, transition: "transform 160ms ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </ButtonBase>
      <Collapse in={open}>
        <Stack sx={{ px: 0.5, pb: 0.5 }}>
          {warnings.map((warning) => (
            <Button
              key={warning.id}
              color={warning.severity === "error" ? "error" : "warning"}
              size="small"
              disabled={!warning.objectRefs.length}
              onClick={() => warning.objectRefs[0] && onSelectRef(warning.objectRefs[0])}
              sx={{ justifyContent: "flex-start", textAlign: "left", textTransform: "none", "&.Mui-disabled": { color: "text.primary" } }}
            >
              {warning.message}
            </Button>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

// The netlab CLI can emit long multi-paragraph stderr (module warnings +
// a fatal error). Surface one line inline and let the rest stay collapsed
// so it never dominates a 330px-wide panel.
export function LensError({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = message.split("\n").filter(Boolean);
  const headline = lines[0] ?? message;
  const rest = lines.slice(1).join("\n");

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Alert
      severity="error"
      icon={<ErrorOutlineIcon fontSize="small" />}
      action={
        <Tooltip title={copied ? "Copied" : "Copy error"}>
          <IconButton
            aria-label="Copy lens error"
            color="inherit"
            size="small"
            onClick={() => void copyMessage()}
            sx={{
              color: copied ? "success.main" : "inherit",
              mt: -0.25,
              transform: copied ? "scale(1.12)" : "scale(1)",
              transition: "color 160ms ease, transform 160ms ease",
            }}
          >
            <ContentCopyIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      }
      sx={{ alignItems: "flex-start" }}
    >
      <Typography variant="body2" sx={{ pr: 0.5, wordBreak: "break-word" }}>{headline}</Typography>
      {rest && (
        <>
          <Link component="button" variant="caption" onClick={() => setExpanded((value) => !value)} sx={{ mt: 0.5, display: "block" }}>
            {expanded ? "Hide details" : "Show details"}
          </Link>
          <Collapse in={expanded}>
            <Box
              component="pre"
              sx={{
                m: 0,
                mt: 0.75,
                p: 1,
                borderRadius: 1,
                bgcolor: "action.hover",
                maxHeight: 220,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {rest}
            </Box>
          </Collapse>
        </>
      )}
    </Alert>
  );
}

// Shown above the active lens body when the transform failed to build — every
// lens except Readiness/Deployment depends on the bundle, so this is where
// the pointer to "why won't it build?" belongs.
export function LensErrorBanner({ error, onOpenReadiness }: { error: string; onOpenReadiness: () => void }) {
  return (
    <Box sx={{ flexShrink: 0 }}>
      <LensError message={error} />
      <Button size="small" startIcon={<FactCheckOutlinedIcon />} onClick={onOpenReadiness} sx={{ mt: 0.5, textTransform: "none" }}>
        Why won&apos;t it build? Open Readiness
      </Button>
    </Box>
  );
}
