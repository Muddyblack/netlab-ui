import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import LinkIcon from "@mui/icons-material/InsertLink";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type ReportCatalogResult, type ReportRunResult } from "../../api/client";

type ReportEntry = ReportCatalogResult["reports"][number];

const isHtml = (name: string) => name.endsWith(".html");

function formatLabel(name: string): string {
  if (name.endsWith(".html")) return "HTML";
  if (name.endsWith(".md")) return "Markdown";
  return "Plain text";
}

/** "BGP Neighbor Short" belongs with "BGP", "Addressing Link" with
 * "Addressing"; a report nobody else shares a first word with goes to "Other". */
function topicsFor(reports: ReportEntry[]): Map<string, string> {
  const firstWord = (name: string) => name.split(/\s+/)[0] ?? name;
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(firstWord(report.name), (counts.get(firstWord(report.name)) ?? 0) + 1);
  return new Map(reports.map((report) => {
    const word = firstWord(report.name);
    return [report.id, (counts.get(word) ?? 0) > 1 ? word : "Other"];
  }));
}

interface ReportGalleryProps {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onSelectObjects: (refs: string[]) => void;
  themeMode: "light" | "dark";
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

function ExportMenu({ result, sessionId }: { result: ReportRunResult; sessionId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const html = result.report.exports.find(isHtml);
  return (
    <Stack direction="row" spacing={0.75}>
      {html && (
        <Tooltip title="Open the rendered report in a new tab">
          <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />}
            href={api.reportExportUrl(sessionId, html, false)} target="_blank" rel="noopener noreferrer">
            Open
          </Button>
        </Tooltip>
      )}
      {result.report.exports.length > 0 && (
        <>
          <Button size="small" variant="text" startIcon={<DownloadIcon />} onClick={(event) => setAnchor(event.currentTarget)}>
            Export
          </Button>
          <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            {result.report.exports.map((name) => (
              <MenuItem key={name} component="a" href={api.reportExportUrl(sessionId, name)} onClick={() => setAnchor(null)}>
                {formatLabel(name)}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  );
}

function ReportTables({ result, rowFilter, onSelectObjects }: {
  result: ReportRunResult;
  rowFilter: string;
  onSelectObjects: (refs: string[]) => void;
}) {
  return (
    <>
      {result.tables.map((table, tableIndex) => {
        const matchingRows = table.rows
          .map((row, rowIndex) => ({ row, rowIndex }))
          .filter(({ row }) => !rowFilter || row.join(" ").toLocaleLowerCase().includes(rowFilter));
        return (
          <Box key={`${table.title}:${tableIndex}`}>
            {table.title && table.title !== result.report.name && <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{table.title}</Typography>}
            <TableContainer component={Paper} variant="outlined">
              <Table stickyHeader size="small">
                <TableHead><TableRow>{table.columns.map((column) => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {matchingRows.map(({ row, rowIndex }) => {
                    const refs = table.objectRefs[rowIndex] ?? [];
                    return (
                      <TableRow key={rowIndex} hover={refs.length > 0} onClick={() => refs.length && onSelectObjects(refs)}
                        sx={{ cursor: refs.length ? "pointer" : "default" }}>
                        {row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}
                      </TableRow>
                    );
                  })}
                  {matchingRows.length === 0 && (
                    <TableRow><TableCell colSpan={table.columns.length} sx={{ color: "text.secondary" }}>No rows match “{rowFilter}”.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        );
      })}
    </>
  );
}

// netlab's HTML reports assume a white page. On a dark theme, recolor the page
// and its tables instead of showing a white slab; the report stays the same
// document, and scripts are still off (see the iframe's sandbox).
const DARK_REPORT_CSS = `<style>
:root { color-scheme: dark; }
html, body { background: transparent !important; color: #d4d4d4 !important; }
table, th, td { border-color: #4a4a4a !important; background-color: transparent !important; color: inherit !important; }
th { background-color: #2a2a2a !important; }
a { color: #ffb14a !important; }
</style>`;

function ReportBody({ result, rowFilter, dark, onSelectObjects }: {
  result: ReportRunResult;
  dark: boolean;
  rowFilter: string;
  onSelectObjects: (refs: string[]) => void;
}) {
  if (result.tables.length) return <ReportTables result={result} rowFilter={rowFilter} onSelectObjects={onSelectObjects} />;
  if (result.report.format === "html" && result.raw) {
    // Lab-generated HTML: no scripts, no same-origin access.
    return (
      <Box component="iframe" title={result.report.name} sandbox="" srcDoc={dark ? `${result.raw}${DARK_REPORT_CSS}` : result.raw}
        sx={{ width: "100%", flex: 1, minHeight: 320, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: dark ? "transparent" : "#fff" }} />
    );
  }
  return (
    <Paper variant="outlined" sx={{ p: 2, overflow: "auto" }}>
      <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
        {result.raw || "This report returned no content."}
      </Typography>
    </Paper>
  );
}

/**
 * Netlab's reports in a panel docked to the left of the canvas — not a modal —
 * so a report row that points at topology objects highlights them on a canvas
 * you can still see. Reports are picked from one grouped, searchable list; the
 * filter above the table only narrows the rows of the open report.
 */
export function ReportGallery({ open, sessionId, onClose, onSelectObjects, themeMode, onToast }: ReportGalleryProps) {
  const [catalog, setCatalog] = useState<ReportCatalogResult["reports"]>([]);
  const [selected, setSelected] = useState<ReportEntry | null>(null);
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [rowFilter, setRowFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(async (report: ReportEntry) => {
    setSelected(report);
    setLoading(true);
    setResult(null);
    setRowFilter("");
    try {
      setResult(await api.runReport(sessionId, report.id));
    } catch (error) {
      onToast(`Could not render report: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [onToast, sessionId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api.getReports(sessionId)
      .then((response) => {
        if (cancelled) return;
        setCatalog(response.reports);
        const initial = response.reports[0];
        if (initial) void loadReport(initial);
        else setLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoading(false);
          onToast(`Could not load reports: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
      });
    return () => { cancelled = true; };
  }, [loadReport, onToast, open, sessionId]);

  const topics = useMemo(() => topicsFor(catalog), [catalog]);
  const options = useMemo(() => [...catalog].sort((a, b) => {
    const ta = topics.get(a.id) ?? "";
    const tb = topics.get(b.id) ?? "";
    if (ta === tb) return a.name.localeCompare(b.name);
    if (ta === "Other") return 1;
    if (tb === "Other") return -1;
    return ta.localeCompare(tb);
  }), [catalog, topics]);
  const normalizedFilter = rowFilter.trim().toLocaleLowerCase();
  const linked = Boolean(result?.tables.some((table) => table.objectRefs.some((refs) => refs.length)));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-label="Reports"
      hideBackdrop
      disableEnforceFocus
      disableScrollLock
      // Not a modal: the canvas beside it stays live.
      sx={{ pointerEvents: "none", "& .MuiDialog-container": { justifyContent: "flex-start", alignItems: "stretch" } }}
      slotProps={{ paper: { sx: { pointerEvents: "auto", m: 1.5, mt: 8, width: "min(680px, 52vw)", maxWidth: "none", height: "auto", maxHeight: "none", flex: "0 0 auto", boxShadow: 8 } } }}
    >
      <Stack spacing={1.5} sx={{ p: 2, height: "100%", minHeight: 0 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Autocomplete
            size="small"
            fullWidth
            disableClearable
            options={options}
            value={selected ?? undefined}
            groupBy={(option) => topics.get(option.id) ?? "Other"}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onChange={(_event, value) => void loadReport(value)}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{option.name}</Typography>
                  {option.description && option.description !== option.name && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{option.description}</Typography>
                  )}
                </Box>
                {option.structuredAdapter && (
                  <Tooltip title="Rows highlight their objects on the canvas"><LinkIcon fontSize="small" color="warning" /></Tooltip>
                )}
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} placeholder="Find a report" slotProps={{ input: { ...params.InputProps, startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
            )}
          />
          <Tooltip title="Refresh report">
            <span><IconButton size="small" disabled={!selected || loading} onClick={() => selected && void loadReport(selected)}><RefreshIcon fontSize="small" /></IconButton></span>
          </Tooltip>
          <IconButton size="small" onClick={onClose} aria-label="Close reports"><CloseIcon fontSize="small" /></IconButton>
        </Stack>

        {loading && <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack>}

        {!loading && result && (
          <>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{result.report.name}</Typography>
                {result.report.description && result.report.description !== result.report.name && (
                  <Typography variant="caption" color="text.secondary">{result.report.description}</Typography>
                )}
              </Box>
              <ExportMenu result={result} sessionId={sessionId} />
            </Stack>
            {result.tables.length > 0 && (
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <TextField size="small" placeholder="Filter rows" value={rowFilter} onChange={(event) => setRowFilter(event.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
                  sx={{ width: 200 }} />
                {linked && <Typography variant="caption" color="text.secondary">Click a row to highlight it on the canvas.</Typography>}
              </Stack>
            )}
            <Box sx={{ overflow: "auto", minHeight: 0, maxHeight: "calc(100vh - 260px)", display: "flex", flexDirection: "column", gap: 1.5 }}>
              <ReportBody result={result} rowFilter={normalizedFilter} dark={themeMode === "dark"} onSelectObjects={onSelectObjects} />
            </Box>
          </>
        )}
        {!loading && !result && catalog.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>No reports available for this lab.</Typography>
        )}
      </Stack>
    </Dialog>
  );
}
