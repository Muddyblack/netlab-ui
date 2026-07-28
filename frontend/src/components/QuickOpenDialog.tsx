import { useEffect, useMemo, useState } from "react";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import BoltIcon from "@mui/icons-material/Bolt";
import DeviceHubIcon from "@mui/icons-material/DeviceHub";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ViewModuleIcon from "@mui/icons-material/ViewModule";
import { Box, Chip, Dialog, DialogContent, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useNodes, useTopoViewerActions } from "@srl-labs/clab-ui";
import { getApiBase } from "../api/endpoint";
import type { LabFileEntry } from "../api/client";
import type { UnitInfo } from "../panels/UnitsDock";

type QuickItem = {
  id: string;
  label: string;
  detail: string;
  kind: "Lab" | "Unit" | "Node" | "Action";
  run: () => void;
};

function quickItemIcon(item: QuickItem) {
  if (item.kind === "Lab") return <FolderOpenIcon fontSize="small" />;
  if (item.kind === "Unit") return <ViewModuleIcon fontSize="small" />;
  if (item.kind === "Node") return <DeviceHubIcon fontSize="small" />;
  if (item.id.includes("group")) return <AccountTreeIcon fontSize="small" />;
  return <BoltIcon fontSize="small" />;
}

function fuzzyScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 1;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 1000 - direct;
  let cursor = 0;
  let score = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return -1;
    score += Math.max(1, 20 - (index - cursor));
    cursor = index + 1;
  }
  return score;
}

export function QuickOpenDialog({ open, onClose, sessionId, isLocked, labs, onOpenLab, onOpenUnit, onInstantiateUnit, actions }: {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  isLocked: boolean;
  labs: LabFileEntry[];
  onOpenLab: (topologyRef: LabFileEntry["topologyRef"]) => void;
  onOpenUnit: (unit: UnitInfo) => void;
  onInstantiateUnit: (unit: UnitInfo) => void;
  actions: Array<{ id: string; label: string; detail: string; run: () => void }>;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [units, setUnits] = useState<UnitInfo[]>([]);
  const nodes = useNodes();
  const topoActions = useTopoViewerActions();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    if (!sessionId) { setUnits([]); return; }
    fetch(`${getApiBase()}/api/topology/templates?sessionId=${encodeURIComponent(sessionId)}`)
      .then((response) => response.ok ? response.json() : { templates: [] })
      .then((value) => setUnits(value.templates ?? []))
      .catch(() => setUnits([]));
  }, [open, sessionId]);

  const items = useMemo<QuickItem[]>(() => [
    ...actions.map((action) => ({ ...action, kind: "Action" as const })),
    ...labs.map((lab) => ({ id: `lab:${lab.path}`, label: lab.labName || lab.filename, detail: lab.path, kind: "Lab" as const, run: () => onOpenLab(lab.topologyRef) })),
    ...units.map((unit) => ({ id: `unit:${unit.path ?? unit.name}`, label: unit.name, detail: `${unit.nodes?.length ?? 0} nodes · unit`, kind: "Unit" as const, run: () => onOpenUnit(unit) })),
    ...(!isLocked ? units.map((unit) => ({ id: `action:instantiate:${unit.name}`, label: `Instantiate ${unit.name}`, detail: "Add this unit to the current canvas", kind: "Action" as const, run: () => onInstantiateUnit(unit) })) : []),
    ...nodes.map((node) => ({ id: `node:${node.id}`, label: node.id, detail: String(node.data?.device ?? node.data?.kind ?? "node"), kind: "Node" as const, run: () => { topoActions.selectNode(node.id); topoActions.editNode(node.id); } }))
  ], [actions, isLocked, labs, nodes, onInstantiateUnit, onOpenLab, onOpenUnit, topoActions, units]);

  const filtered = useMemo(() => items
    .map((item) => ({ item, score: fuzzyScore(`${item.label} ${item.detail} ${item.kind}`, query) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, 40)
    .map(({ item }) => item), [items, query]);

  useEffect(() => setActiveIndex(0), [query]);
  const choose = (item: QuickItem | undefined) => { if (!item) return; onClose(); item.run(); };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { position: "fixed", top: "12vh", m: 0, maxHeight: "70vh" } }}>
      <DialogContent sx={{ p: 0 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Quick open labs, units, nodes, and actions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            if (event.key === "Enter") { event.preventDefault(); choose(filtered[activeIndex]); }
          }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>, endAdornment: <InputAdornment position="end"><Chip size="small" label="Ctrl P" variant="outlined" /></InputAdornment> }}
          sx={{ "& .MuiOutlinedInput-notchedOutline": { border: 0 }, borderBottom: 1, borderColor: "divider" }}
        />
        <List dense disablePadding sx={{ overflow: "auto", maxHeight: "55vh", py: 0.5 }}>
          {filtered.map((item, index) => (
            <ListItemButton key={item.id} selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(item)}>
              <ListItemIcon sx={{ minWidth: 34 }}>{quickItemIcon(item)}</ListItemIcon>
              <ListItemText primary={item.label} secondary={item.detail} primaryTypographyProps={{ fontWeight: 600 }} />
              <Typography variant="caption" color="text.secondary">{item.kind}</Typography>
            </ListItemButton>
          ))}
          {filtered.length === 0 && <Box sx={{ p: 3, textAlign: "center" }}><Typography variant="body2" color="text.secondary">No matching labs, units, nodes, or actions.</Typography></Box>}
        </List>
      </DialogContent>
    </Dialog>
  );
}
