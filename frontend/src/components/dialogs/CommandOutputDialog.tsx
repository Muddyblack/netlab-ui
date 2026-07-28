import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { lazy, Suspense, useState } from "react";

// Same readonly Monaco viewer the generated-config preview uses, lazy-loaded
// so command-output dialogs (opened rarely) don't pay for Monaco up front.
const GeneratedConfigViewer = lazy(() => import("../node-editor/GeneratedConfigViewer"));

// GeneratedConfigViewer infers its Monaco language from a file extension, so
// give it a synthetic path matching the caller's declared language.
const EXT_FOR_LANGUAGE: Record<string, string> = {
  shell: "sh",
  yaml: "yaml",
  json: "json",
  ini: "ini",
  plaintext: "txt",
};

/** In-app replacement for popping CLI output into a blank browser tab (blocked
 * by popup blockers, no chrome, easy to lose track of). Shows the same output
 * docked in a dialog, syntax-highlighted via Monaco, so it reads as part of
 * the app instead of a stray window. */
export function CommandOutputDialog({
  open,
  onClose,
  title,
  loading,
  output,
  errorMessage,
  themeMode,
  language = "plaintext",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  loading: boolean;
  output: string | null;
  errorMessage: string | null;
  themeMode: "light" | "dark";
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          {errorMessage && <Chip size="small" label="Failed" color="error" variant="outlined" />}
          <Tooltip title={copied ? "Copied" : "Copy output"}>
            <span>
              <IconButton
                size="small"
                aria-label="Copy output"
                onClick={() => void copy()}
                disabled={!output}
                sx={{ color: copied ? "success.main" : "inherit", transition: "color 160ms ease" }}
              >
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: "grid", placeItems: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {!loading && errorMessage && (
          <Typography variant="body2" color="error" sx={{ py: 1 }}>
            {errorMessage}
          </Typography>
        )}
        {!loading && !errorMessage && (
          output ? (
            <Box sx={{ height: "65vh", overflow: "hidden", border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Suspense fallback={<Box sx={{ height: "100%", display: "grid", placeItems: "center" }}><CircularProgress size={20} /></Box>}>
                <GeneratedConfigViewer content={output} path={`command-output.${EXT_FOR_LANGUAGE[language] ?? "txt"}`} theme={themeMode} />
              </Suspense>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No output.</Typography>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
