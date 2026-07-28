import { useMemo, useEffect, useState, useCallback, useRef, type RefObject } from "react";
import { getApiBase } from "../api/endpoint";
import {
  Box,
  Typography,
  IconButton,
  Button,
  CircularProgress,
  Tooltip,
  TextField,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Paper
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WidgetsIcon from "@mui/icons-material/Widgets";

import { useIsLocked, useNodes } from "@srl-labs/clab-ui";
import { CreateUnitDialog } from "../components/dialogs/CreateUnitDialog";
import { PlaceUnitDialog } from "../components/dialogs/PlaceUnitDialog";
import { UnitPreview } from "../components/UnitPreview";
import { blurTrigger } from "../utils/focus";
import { usePanelInsets } from "./units-dock/usePanelInsets";
import { UNIT_DRAG_MIME, useCanvasDropTarget } from "./units-dock/useCanvasDropTarget";
import { UnitCard } from "./units-dock/UnitCard";
import type { UnitInfo, UnitInstance } from "./units-dock/types";

export type { UnitInfo, UnitNode, UnitLink, UnitInclude } from "./units-dock/types";

const DOCK_OPEN_KEY = "netlab.unitsDock.open";
const PINNED_UNITS_KEY = "netlab.unitsDock.pinned";

function useSessionDockBottomOffset(rootRef: RefObject<HTMLDivElement | null>): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let raf = 0;
    let resizeObserver: ResizeObserver | null = null;

    const measure = () => {
      raf = 0;
      const root = rootRef.current;
      const container = root?.parentElement;
      const sessionDock = document.querySelector<HTMLElement>("[data-netlab-session-dock]");
      if (!container || !sessionDock) {
        setOffset((current) => (current === 0 ? current : 0));
        return;
      }

      const crect = container.getBoundingClientRect();
      const drect = sessionDock.getBoundingClientRect();
      const overlapsContainer =
        drect.width > 0 &&
        drect.height > 0 &&
        drect.right > crect.left &&
        drect.left < crect.right &&
        drect.bottom > crect.top &&
        drect.top < crect.bottom;
      const next = overlapsContainer ? Math.max(0, Math.round(crect.bottom - drect.top)) : 0;
      setOffset((current) => (current === next ? current : next));
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    const observeSessionDock = () => {
      resizeObserver?.disconnect();
      const sessionDock = document.querySelector<HTMLElement>("[data-netlab-session-dock]");
      if (sessionDock) {
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(sessionDock);
      }
      schedule();
    };

    observeSessionDock();
    const mutationObserver = new MutationObserver(observeSessionDock);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [rootRef]);

  return offset;
}

function loadPinnedUnits(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(PINNED_UNITS_KEY) || "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

interface UnitsDockProps {
  sessionId: string;
  /** Any value that changes when unit files may have changed (e.g. the active
   * tab id) — the dock refetches so previews stay current after edits. */
  refreshKey?: unknown;
  onRefresh: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
  onOpenUnit: (unit: UnitInfo) => void;
}

/** Bottom dock over the canvas: every unit in the workspace as a card with a
 * rendered mini-preview. Drag a card onto the canvas to place an instance. */
export function UnitsDock({ sessionId, refreshKey, onRefresh, onToast, onOpenUnit }: UnitsDockProps) {
  const isLocked = useIsLocked();
  const [units, setUnits] = useState<UnitInfo[]>([]);
  const [instances, setInstances] = useState<UnitInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(() => localStorage.getItem(DOCK_OPEN_KEY) !== "0");
  const [pinnedUnits, setPinnedUnits] = useState<Record<string, boolean>>(loadPinnedUnits);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [unitToDelete, setUnitToDelete] = useState("");
  const [unitToPlace, setUnitToPlace] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const insets = usePanelInsets(rootRef);
  const sessionDockBottomOffset = useSessionDockBottomOffset(rootRef);

  // Current graph nodes — used for the selection count and for picking a
  // collision-free instance prefix when a unit is dropped on the canvas.
  const nodes = useNodes();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedNodes = useMemo(
    () => nodes.filter((node) => node.selected && node.type === "topology-node"),
    [nodes]
  );

  const BASE = getApiBase();

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      localStorage.setItem(DOCK_OPEN_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const togglePinned = useCallback((unit: UnitInfo) => {
    setPinnedUnits((current) => {
      const next = { ...current, [unit.path]: !current[unit.path] };
      if (!next[unit.path]) delete next[unit.path];
      localStorage.setItem(PINNED_UNITS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const loadUnits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/topology/templates?sessionId=${sessionId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to load units");
      }
      const data = await res.json();
      setUnits(data.templates || []);
      // Provenance is best-effort: a failure here must not block the unit list.
      fetch(`${BASE}/api/topology/templates/instances?sessionId=${sessionId}`)
        .then((r) => (r.ok ? r.json() : { instances: [] }))
        .then((d) => setInstances(d.instances || []))
        .catch(() => setInstances([]));
      return (data.templates || []) as UnitInfo[];
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [] as UnitInfo[];
    } finally {
      setLoading(false);
    }
  }, [sessionId, BASE]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits, refreshKey]);

  const instantiateAt = useCallback(async (unitName: string, origin: { x: number; y: number }) => {
    if (isLocked) {
      onToast("Unlock the lab before placing a unit.", "warning");
      return;
    }
    // Instance prefix must not collide with existing nodes/groups; expansion
    // names nodes `<prefix>_<node>` and the instance group `<prefix>`.
    const ids = new Set(nodesRef.current.map((n) => n.id));
    const unit = units.find((candidate) => candidate.name === unitName);
    const longestNodeName = Math.max(0, ...(unit?.nodes || []).map((node) => String(node.name || "").length));
    // One character is consumed by the underscore between prefix and node.
    // Reserve room for the numeric instance suffix as well (KISS + 1 becomes
    // KIS1 when its node suffixes need a four-character prefix at most).
    const maxPrefixLength = 15 - longestNodeName;
    if (maxPrefixLength < 2) {
      onToast(`Could not place ${unitName}: its node names leave no room for a valid instance prefix (netlab maximum is 16 characters).`, "error");
      return;
    }

    let prefix = "";
    for (let k = 1; ; k++) {
      const counter = String(k);
      const stemLength = maxPrefixLength - counter.length;
      if (stemLength < 1) {
        onToast(`Could not place ${unitName}: no collision-free prefix fits netlab's 16-character identifier limit.`, "error");
        return;
      }
      prefix = `${unitName.slice(0, stemLength)}${counter}`;
      if (!ids.has(prefix) && ![...ids].some((id) => id.startsWith(`${prefix}_`))) break;
    }
    try {
      const res = await fetch(`${BASE}/api/topology/templates/instantiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, template: unitName, count: 1, prefix, origin })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to place unit");
      }
      onRefresh();
      setUnits((current) => current.map((unit) => (
        unit.name === unitName ? { ...unit, usageCount: (unit.usageCount || 0) + 1 } : unit
      )));
      onToast(`Placed ${prefix} on the canvas`, "success");
    } catch (err) {
      onToast(`Could not place ${unitName}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [BASE, isLocked, sessionId, onRefresh, onToast, units]);

  useCanvasDropTarget(useCallback((name, origin) => void instantiateAt(name, origin), [instantiateAt]), isLocked);

  const handleConfirmDelete = async () => {
    if (!unitToDelete) return;
    try {
      const res = await fetch(`${BASE}/api/topology/templates/${encodeURIComponent(unitToDelete)}?sessionId=${sessionId}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to delete unit");
      }
      const data = await res.json();
      setUnits(data.templates || []);
    } catch (err) {
      onToast(`Could not delete ${unitToDelete}: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUnitToDelete("");
    }
  };

  const handleSaved = useCallback(
    async (name: string, openAfter: boolean) => {
      const list = await loadUnits();
      const unit = list.find((t) => t.name === name);
      if (unit) {
        onToast(`Saved unit ${name}`, "success");
        if (openAfter) onOpenUnit(unit);
      }
    },
    [loadUnits, onOpenUnit, onToast]
  );

  // Export one unit as a portable .netlab-unit.json bundle (topology +
  // view-state) that can be shared and imported into any workspace.
  const handleExport = useCallback(async (name: string) => {
    try {
      const res = await fetch(`${BASE}/api/topology/templates/${encodeURIComponent(name)}/export?sessionId=${sessionId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Export failed");
      const bundle = await res.json();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.netlab-unit.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      onToast(`Could not export ${name}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [BASE, sessionId, onToast]);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportFile = useCallback(async (file: File) => {
    try {
      const bundle = JSON.parse(await file.text());
      const res = await fetch(`${BASE}/api/topology/templates/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, bundle }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Import failed");
      const data = await res.json();
      setUnits(data.templates || []);
      onToast(`Imported unit ${data.name}`, "success");
    } catch (err) {
      onToast(`Could not import unit: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [BASE, sessionId, onToast]);

  const unitsByName = useMemo(() => Object.fromEntries(units.map((u) => [u.name, u])), [units]);

  // How many still-present placed instances of each unit are behind the unit's
  // current version — drives the "N need update" badge on the card.
  const outdatedByUnit = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inst of instances) {
      if (inst.exists && inst.outdated) counts[inst.unit] = (counts[inst.unit] ?? 0) + 1;
    }
    return counts;
  }, [instances]);

  const sortedUnits = useMemo(() => [...units].sort((left, right) => {
    const pinOrder = Number(Boolean(pinnedUnits[right.path])) - Number(Boolean(pinnedUnits[left.path]));
    if (pinOrder) return pinOrder;
    const usageOrder = (right.usageCount || 0) - (left.usageCount || 0);
    return usageOrder || left.name.localeCompare(right.name);
  }), [units, pinnedUnits]);

  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return sortedUnits;
    const q = searchQuery.toLowerCase();
    return sortedUnits.filter((t) => t.name.toLowerCase().includes(q));
  }, [sortedUnits, searchQuery]);

  return (
    <Box
      ref={rootRef}
      sx={{
        position: "absolute",
        bottom: sessionDockBottomOffset,
        left: insets.left,
        right: insets.right,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none"
      }}
    >
      {!open ? (
        // Collapsed: a slim strip that still shows every unit as a tiny
        // draggable preview, so collapsing never hides the library.
        <Paper
          elevation={3}
          sx={{
            pointerEvents: "auto",
            mb: 1,
            pl: 1.25,
            pr: 0.5,
            py: 0.25,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            borderRadius: 4,
            maxWidth: "70%",
            overflow: "hidden"
          }}
        >
          <WidgetsIcon sx={{ fontSize: 16, color: "text.secondary", flexShrink: 0 }} />
          <Box sx={{ display: "flex", gap: 0.5, overflowX: "auto", alignItems: "center" }}>
            {sortedUnits.map((unit) => (
              <Tooltip key={unit.name} title={isLocked ? "Unlock the lab to place units" : `${unit.name} — drag onto the canvas`} arrow>
                <Box
                  draggable={!isLocked}
                  onDragStart={(e) => {
                    if (isLocked) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData(UNIT_DRAG_MIME, unit.name);
                    e.dataTransfer.effectAllowed = "copyMove";
                  }}
                  sx={{
                    display: "flex",
                    borderRadius: 0.75,
                    cursor: isLocked ? "not-allowed" : "grab",
                    opacity: isLocked ? 0.5 : 1,
                    flexShrink: 0,
                    bgcolor: "action.hover",
                    "&:active": { cursor: "grabbing" },
                    "&:hover": { outline: 1, outlineColor: "primary.main" }
                  }}
                >
                  <UnitPreview unit={unit} unitsByName={unitsByName} width={40} height={22} />
                </Box>
              </Tooltip>
            ))}
            {units.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                Units
              </Typography>
            )}
          </Box>
          <Tooltip title="Expand units dock" arrow>
            <IconButton size="small" onClick={toggleOpen} aria-label="Expand units dock" sx={{ p: 0.25, flexShrink: 0 }}>
              <ExpandLessIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Paper>
      ) : (
        <Paper
          square
          elevation={4}
          sx={{
            pointerEvents: "auto",
            width: "100%",
            borderTop: 1,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column"
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, px: 1.5, pt: 0.75 }}>
            <WidgetsIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
              Units
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
              {isLocked ? "unlock the lab to place units" : "drag onto the canvas to place"}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <TextField
              size="small"
              placeholder="Search units..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              sx={{
                width: 200,
                minWidth: 120,
                flexShrink: 1,
                "& .MuiOutlinedInput-root": {
                  fontSize: "0.75rem",
                  bgcolor: "action.hover",
                  "& fieldset": { borderColor: "divider" },
                  "& .MuiOutlinedInput-input": { py: 0.5 }
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery("")} edge="end" sx={{ color: "text.secondary", p: 0.25 }}>
                      <ClearIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={(event) => {
                blurTrigger(event.currentTarget);
                setCreateDialogOpen(true);
              }}
              sx={{ textTransform: "none", py: 0.25, flexShrink: 0 }}
            >
              {selectedNodes.length > 0 ? `Package ${selectedNodes.length} selected` : "New Unit"}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportFile(file);
                event.target.value = "";
              }}
            />
            <Tooltip title="Import a unit (.netlab-unit.json)" arrow>
              <IconButton size="small" onClick={() => importInputRef.current?.click()} aria-label="Import unit" sx={{ flexShrink: 0 }}>
                <FileUploadOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Collapse units dock" arrow>
              <IconButton size="small" onClick={toggleOpen} aria-label="Collapse units dock">
                <ExpandMoreIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ display: "flex", gap: 1, px: 1.5, py: 1, overflowX: "auto", minHeight: 108, alignItems: "stretch" }}>
            {(() => {
              if (loading) {
                return (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>
                    <CircularProgress size={18} />
                  </Box>
                );
              }
              if (error) {
                return (
                  <Typography variant="caption" color="error" sx={{ alignSelf: "center", px: 1 }}>
                    {error}
                  </Typography>
                );
              }
              if (filteredUnits.length === 0) {
                return (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", alignSelf: "center", px: 1 }}>
                    {units.length === 0
                      ? "No units yet. Create one — from the current selection, from other units, or empty to draw it on its own canvas."
                      : "No matching units found."}
                  </Typography>
                );
              }
              return filteredUnits.map((unit) => (
                <UnitCard
                  key={unit.name}
                  unit={unit}
                  unitsByName={unitsByName}
                  isLocked={isLocked}
                  outdatedCount={outdatedByUnit[unit.name] || 0}
                  pinned={Boolean(pinnedUnits[unit.path])}
                  onOpen={onOpenUnit}
                  onTogglePin={togglePinned}
                  onPlace={setUnitToPlace}
                  onExport={(name) => void handleExport(name)}
                  onDelete={setUnitToDelete}
                />
              ));
            })()}
          </Box>
        </Paper>
      )}

      <CreateUnitDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        sessionId={sessionId}
        existingUnits={units}
        onSaved={(name, openAfter) => void handleSaved(name, openAfter)}
      />

      <PlaceUnitDialog
        open={Boolean(unitToPlace)}
        sessionId={sessionId}
        unitName={unitToPlace}
        onClose={() => setUnitToPlace("")}
        onPlaced={() => { void loadUnits(); onRefresh(); }}
        onToast={onToast}
      />

      <Dialog open={Boolean(unitToDelete)} onClose={() => setUnitToDelete("")} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Unit</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete the unit <strong>{unitToDelete}</strong>? Its file is
            removed from the workspace. This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnitToDelete("")} size="small">
            Cancel
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" size="small">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
