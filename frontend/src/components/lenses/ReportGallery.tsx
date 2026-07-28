import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
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

interface ReportGalleryProps {
  open: boolean;
  sessionId: string;
  onClose: () => void;
  onSelectObjects: (refs: string[]) => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

export function ReportGallery({ open, sessionId, onClose, onSelectObjects, onToast }: ReportGalleryProps) {
  const [catalog, setCatalog] = useState<ReportCatalogResult["reports"]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const loadReport = useCallback(async (reportId: string) => {
    setSelectedId(reportId);
    setLoading(true);
    setResult(null);
    try {
      setResult(await api.runReport(sessionId, reportId));
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
        if (initial) void loadReport(initial.id);
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

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleReports = useMemo(() => catalog.filter((report) => (
    !normalizedQuery || `${report.name} ${report.description} ${report.source}`.toLocaleLowerCase().includes(normalizedQuery)
  )), [catalog, normalizedQuery]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth slotProps={{ paper: { sx: { height: "82vh" } } }}>
      <DialogTitle sx={{ py: 1.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h6">Interactive report gallery</Typography>
            <Typography variant="caption" color="text.secondary">
              Search Netlab reports, then select a row to locate its topology objects.
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close reports"><CloseIcon /></IconButton>
        </Stack>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 0, display: "grid", gridTemplateColumns: "270px minmax(0, 1fr)", minHeight: 0 }}>
        <Box sx={{ borderRight: 1, borderColor: "divider", minHeight: 0, overflow: "auto" }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search reports"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            sx={{ p: 1.5, pb: 0.75 }}
          />
          <List dense>
            {visibleReports.map((report) => (
              <ListItemButton key={report.id} selected={selectedId === report.id} onClick={() => void loadReport(report.id)}>
                <ListItemText
                  primary={report.name}
                  secondary={report.description || report.id}
                  slotProps={{ secondary: { noWrap: true } }}
                />
                {report.structuredAdapter && <Chip size="small" label="linked" color="warning" variant="outlined" />}
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Box sx={{ minWidth: 0, minHeight: 0, overflow: "auto", p: 2 }}>
          {loading && <Stack alignItems="center" justifyContent="center" sx={{ height: "100%" }}><CircularProgress size={28} /></Stack>}
          {!loading && result && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="h6">{result.report.name}</Typography>
                  <Typography variant="body2" color="text.secondary">{result.report.description}</Typography>
                </Box>
                <Tooltip title="Refresh report">
                  <IconButton onClick={() => void loadReport(result.report.id)}><RefreshIcon /></IconButton>
                </Tooltip>
              </Stack>
              {result.tables.map((table, tableIndex) => {
                const matchingRows = table.rows
                  .map((row, rowIndex) => ({ row, rowIndex }))
                  .filter(({ row }) => !normalizedQuery || row.join(" ").toLocaleLowerCase().includes(normalizedQuery));
                return (
                  <Box key={`${table.title}:${tableIndex}`}>
                    {table.title && <Typography variant="subtitle1" sx={{ mb: 1 }}>{table.title}</Typography>}
                    <TableContainer component={Paper} variant="outlined">
                      <Table stickyHeader size="small">
                        <TableHead><TableRow>{table.columns.map((column) => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
                        <TableBody>
                          {matchingRows.map(({ row, rowIndex }) => {
                            const refs = table.objectRefs[rowIndex] ?? [];
                            return (
                              <TableRow
                                key={rowIndex}
                                hover={refs.length > 0}
                                onClick={() => refs.length && onSelectObjects(refs)}
                                sx={{ cursor: refs.length ? "pointer" : "default" }}
                              >
                                {row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                );
              })}
              {!result.tables.length && (
                <Paper variant="outlined" sx={{ p: 2, overflow: "auto" }}>
                  <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
                    {result.raw || "This report returned no content."}
                  </Typography>
                </Paper>
              )}
            </Stack>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
