import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
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
import { useCallback, useEffect, useState } from "react";

import { api, type DeploymentLog } from "../../api/client";

type LogSection = NonNullable<DeploymentLog["lines"][number]["section"]>;

const SECTION_LABELS: Record<string, string> = {
  preparing: "Prepare",
  generating: "Generate configs",
  creating: "Create nodes",
  configuring: "Configure",
  stopping: "Stop nodes",
  complete: "Complete",
  failed: "Failed",
};

/** Reopenable transcript of the most recent lifecycle run. clab-ui's progress
 * modal is transient — once dismissed, its live output is gone — so this pulls
 * the backend-retained log so a failed run's output stays inspectable. */
export function DeploymentLogDialog({
  sessionId,
  open,
  onClose,
  initialSection = null,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  initialSection?: string | null;
}) {
  const [log, setLog] = useState<DeploymentLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState<string | null>(initialSection);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      setLog(await api.getDeploymentLog(sessionId));
    } catch {
      setLog({ available: false, running: false, done: false, lines: [] });
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (open) {
      setSection(initialSection);
      void load();
    }
  }, [open, initialSection, load]);

  const sections = Array.from(new Set((log?.lines ?? []).map((entry) => entry.section).filter((value): value is LogSection => value !== null)));
  const visibleLines = section ? (log?.lines ?? []).filter((entry) => entry.section === section) : (log?.lines ?? []);
  const asText = visibleLines.map((entry) => entry.line).join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  let exitLabel: string | null = null;
  if (log?.exitCode != null) exitLabel = `Exit ${log.exitCode}`;
  if (log?.exitCode === 0) exitLabel = "Exit 0";
  if (log?.running) exitLabel = "Running";
  let exitColor: "default" | "success" | "error" = "error";
  if (log?.exitCode === 0) exitColor = "success";
  if (log?.running) exitColor = "default";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Last run output{log?.action ? ` · netlab ${log.action}` : ""}
            </Typography>
            {log?.finishedAt && (
              <Typography variant="caption" color="text.secondary">
                Finished {new Date(log.finishedAt).toLocaleString()}
              </Typography>
            )}
          </Box>
          {exitLabel && (
            <Chip
              size="small"
              label={exitLabel}
              color={exitColor}
              variant="outlined"
            />
          )}
          <Tooltip title="Reload"><span><IconButton size="small" onClick={() => void load()} disabled={loading}>{loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}</IconButton></span></Tooltip>
          <Tooltip title={copied ? "Copied" : "Copy output"}>
            <span>
              <IconButton
                size="small"
                aria-label="Copy run output"
                onClick={() => void copy()}
                disabled={!asText}
                sx={{ color: copied ? "success.main" : "inherit", transition: "color 160ms ease" }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && !log && <Box sx={{ display: "grid", placeItems: "center", py: 4 }}><CircularProgress size={24} /></Box>}
        {log && !log.available && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No run output retained yet. Deploy, Initial, Restart, or Create to populate it.
          </Typography>
        )}
        {log?.available && (
          <Stack spacing={1.25}>
            {sections.length > 1 && (
              <Stack direction="row" gap={0.75} flexWrap="wrap" aria-label="Log section filter">
                <Chip size="small" label={`All · ${log.lines.length}`} color={section === null ? "primary" : "default"} variant={section === null ? "filled" : "outlined"} onClick={() => setSection(null)} />
                {sections.map((name) => {
                  const count = log.lines.filter((entry) => entry.section === name).length;
                  return <Chip key={name} size="small" label={`${SECTION_LABELS[name] ?? name} · ${count}`} color={section === name ? "primary" : "default"} variant={section === name ? "filled" : "outlined"} onClick={() => setSection(name)} />;
                })}
              </Stack>
            )}
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.25,
                borderRadius: 1,
                bgcolor: "action.hover",
                maxHeight: "60vh",
                overflow: "auto",
                fontSize: 12,
                lineHeight: 1.5,
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {visibleLines.length === 0
                ? <Typography variant="body2" color="text.secondary">No output was recorded for this section.</Typography>
                : visibleLines.map((entry, index) => (
                  <Box
                    key={index}
                    component="span"
                    sx={{
                      display: "block",
                      // The app's MUI theme maps palette colors to VS Code CSS
                      // vars, which alpha() can't parse — use literal red so the
                      // stderr tint never throws at render time.
                      color: entry.stream === "stderr" ? "#f87171" : "inherit",
                      bgcolor: entry.stream === "stderr" ? "rgba(239, 68, 68, 0.10)" : "transparent",
                    }}
                  >
                    {entry.line || " "}
                  </Box>
                ))}
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
