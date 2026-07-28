import { useState, useMemo, useEffect } from "react";
import { getApiBase } from "../../api/endpoint";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Alert,
  Chip,
  Tooltip
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import AutoAwesomeMotionIcon from "@mui/icons-material/AutoAwesomeMotion";

import { useNodes, useEdges } from "@srl-labs/clab-ui";
import type { Edge } from "@xyflow/react";
import type { UnitInfo } from "../../panels/UnitsDock";
import { VIEW_STATE_KEYS } from "./create-group-template/helpers";

interface CreateUnitDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  existingUnits: UnitInfo[];
  onSaved: (name: string, openAfter: boolean) => void;
}

/** Creating a unit is deliberately tiny: name it, create it. What the unit is
 * *made of* — devices, included units, wiring, modules — is built afterwards on
 * the unit's own canvas and in the Composer rail, where those are direct
 * manipulation instead of a wall of dropdowns. The one shortcut kept here is
 * "package the current selection", which carves the selected nodes (and the
 * links between them) straight into a new unit. */
export function CreateUnitDialog({ open, onClose, sessionId, existingUnits, onSaved }: CreateUnitDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nodes = useNodes();
  const edges = useEdges();

  // React Flow stores group boxes, text, and shapes in the same array as
  // topology nodes; only real topology nodes belong in a unit.
  const selectedNodes = useMemo(
    () => nodes.filter((node) => node.selected && node.type === "topology-node"),
    [nodes]
  );
  const selectedNodeIds = useMemo(() => new Set(selectedNodes.map((n) => n.id)), [selectedNodes]);

  // Links touching the selection: internal ones become the unit's wiring;
  // links out to the rest of the lab are kept as external connections.
  const { selectionLinks, externalNodes } = useMemo(() => {
    if (selectedNodeIds.size === 0) return { selectionLinks: [] as Edge[], externalNodes: [] as string[] };
    const links: Edge[] = [];
    const extNodes = new Set<string>();
    for (const edge of edges) {
      const sourceIn = selectedNodeIds.has(edge.source);
      const targetIn = selectedNodeIds.has(edge.target);
      if (!sourceIn && !targetIn) continue;
      links.push(edge);
      if (!sourceIn) extNodes.add(edge.source);
      if (!targetIn) extNodes.add(edge.target);
    }
    return { selectionLinks: links, externalNodes: Array.from(extNodes) };
  }, [edges, selectedNodeIds]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
  }, [open]);

  const trimmed = name.trim();
  const packaging = selectedNodes.length > 0;
  const nameCollision = useMemo(
    () => existingUnits.some((u) => u.name === trimmed),
    [existingUnits, trimmed]
  );

  const handleSave = async (openAfter: boolean) => {
    if (!trimmed) {
      setError("Give the unit a name");
      return;
    }
    setSaving(true);
    setError(null);

    // Only when packaging a selection do we send nodes/links; an empty unit is
    // just a name — its contents are built afterwards.
    const templateNodes = selectedNodes.map((node) => {
      const nodeData = node.data as Record<string, unknown>;
      const device = nodeData?.kind || nodeData?.device || null;
      const attrs: Record<string, unknown> = {};
      if (nodeData && typeof nodeData === "object") {
        for (const [k, v] of Object.entries(nodeData)) {
          if (!VIEW_STATE_KEYS.has(k) && v !== undefined && v !== null && v !== "") attrs[k] = v;
        }
      }
      return { name: node.id, device, attrs, x: node.position.x, y: node.position.y };
    });

    const body = {
      name: trimmed,
      nodes: templateNodes,
      links: selectionLinks.map((edge) => ({
        endpoints: [edge.source, edge.target],
        attrs: edge.data?.extraData || {}
      })),
      module: [],
      includes: []
    };

    try {
      const res = await fetch(`${getApiBase()}/api/topology/templates?sessionId=${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to save unit");
      }
      onSaved(trimmed, openAfter);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: 2, overflow: "hidden" } }}
    >
      <DialogTitle sx={{ px: 3, py: 2.25, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 38,
              height: 38,
              flexShrink: 0,
              borderRadius: 1.25,
              bgcolor: "primary.main",
              color: "primary.contrastText"
            }}
          >
            {packaging ? <AutoAwesomeMotionIcon fontSize="small" /> : <AccountTreeIcon fontSize="small" />}
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {packaging ? "Package selection as unit" : "New unit"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {packaging
                ? "Save the selected nodes as a reusable unit."
                : "A reusable building block — you'll compose it on its own canvas."}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            placeholder="e.g. workplace, room, building"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed && !saving) void handleSave(true);
            }}
            fullWidth
            size="small"
            autoFocus
            required
            helperText={nameCollision ? `A unit named "${trimmed}" exists — it will be overwritten.` : " "}
            FormHelperTextProps={{ sx: { color: nameCollision ? "warning.main" : "text.secondary" } }}
          />

          {packaging ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 1.25,
                p: 1.5,
                border: 1,
                borderColor: "primary.main",
                borderRadius: 1.5,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "& .MuiChip-root": { color: "inherit", borderColor: "currentColor", bgcolor: "transparent" }
              }}
            >
              <CheckCircleOutlineIcon sx={{ mt: 0.15, fontSize: 19, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {selectedNodes.length} {selectedNodes.length === 1 ? "node" : "nodes"} from the canvas
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.75 }}>
                  {selectedNodes.map((n) => (
                    <Chip key={n.id} label={n.id} size="small" variant="outlined" />
                  ))}
                  {externalNodes.length > 0 && (
                    <Tooltip
                      title={`Links to ${externalNodes.join(", ")} are kept as the unit's external connections`}
                      arrow
                    >
                      <Chip
                        label={`${externalNodes.length} external link${externalNodes.length === 1 ? "" : "s"}`}
                        size="small"
                        variant="outlined"
                      />
                    </Tooltip>
                  )}
                </Box>
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              After creating, open it on the canvas to add devices and draw links, and use the Composer to include
              other units and wire connections that scale.
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, borderTop: 1, borderColor: "divider", gap: 0.5 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => void handleSave(false)} disabled={saving || !trimmed} sx={{ textTransform: "none" }}>
          Create
        </Button>
        <Button
          onClick={() => void handleSave(true)}
          variant="contained"
          startIcon={<AddIcon />}
          disabled={saving || !trimmed}
          sx={{ textTransform: "none" }}
        >
          {saving ? "Creating…" : "Create & open"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
