import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ClearIcon from "@mui/icons-material/Clear";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import SearchIcon from "@mui/icons-material/Search";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";

import { useNodes } from "@srl-labs/clab-ui";
import { getApiBase } from "../api/endpoint";
import { blurTrigger } from "../utils/focus";
import type { GroupInfo, GroupsPayload } from "./groups/types";
import { GroupEditorDialog } from "./groups/GroupEditorDialog";
import { GroupCard } from "./groups/GroupCard";

export type { GroupInfo } from "./groups/types";

function GroupsHeader({ groupCount, selectedNodeCount, onCreate }: {
  groupCount: number;
  selectedNodeCount: number;
  onCreate: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <Box sx={{ flexShrink: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Configuration groups</Typography>
          <Typography variant="caption" color="text.secondary">
            {groupCount === 0
              ? "Apply shared settings once."
              : `${groupCount} ${groupCount === 1 ? "group" : "groups"} · expand a card for details`}
          </Typography>
        </Box>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onCreate} sx={{ flexShrink: 0 }}>
          New
        </Button>
      </Stack>
      <Collapse in={selectedNodeCount > 0}>
        <Alert severity="info" icon={false} sx={{ mt: 1.25, py: 0.25, "& .MuiAlert-message": { fontSize: "0.75rem" } }}>
          {selectedNodeCount} canvas {selectedNodeCount === 1 ? "node is" : "nodes are"} ready to add to a new group.
        </Alert>
      </Collapse>
    </Box>
  );
}

function GroupsSearchBar({ searchQuery, setSearchQuery, showExpandToggle, allExpanded, onToggleExpandAll }: {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  showExpandToggle: boolean;
  allExpanded: boolean;
  onToggleExpandAll: () => void;
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
      <TextField
        size="small"
        fullWidth
        placeholder="Search groups, members, modules…"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
            </InputAdornment>
          ),
          endAdornment: searchQuery ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear search" onClick={() => setSearchQuery("")}>
                <ClearIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined
        }}
        sx={{ "& .MuiOutlinedInput-root": { bgcolor: "background.paper" } }}
      />
      {showExpandToggle && (
        <Tooltip title={allExpanded ? "Collapse all" : "Expand all"}>
          <IconButton
            size="small"
            onClick={onToggleExpandAll}
            aria-label={allExpanded ? "Collapse all groups" : "Expand all groups"}
            sx={{ flexShrink: 0, border: "1px solid", borderColor: "divider", borderRadius: 1, width: 36, height: 36 }}
          >
            {allExpanded ? <UnfoldLessIcon sx={{ fontSize: 18 }} /> : <UnfoldMoreIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

function GroupsEmptyState({ hasGroups, onCreate }: { hasGroups: boolean; onCreate: (event: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <Box sx={{ py: 4, px: 2, textAlign: "center", border: "1px dashed", borderColor: "divider", borderRadius: 2, bgcolor: "action.hover" }}>
      <HubOutlinedIcon color="disabled" sx={{ fontSize: 36, mb: 1 }} />
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {hasGroups ? "No groups match" : "No configuration groups yet"}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {hasGroups ? "Try a different search term." : "Group nodes to configure routing and services together."}
      </Typography>
      {!hasGroups && (
        <Button size="small" sx={{ mt: 1.5 }} onClick={onCreate}>
          Create your first group
        </Button>
      )}
    </Box>
  );
}

function GroupsList({ groups, filteredGroups, searchQuery, groupNames, expanded, onToggle, onEdit, onDelete }: {
  groups: GroupInfo[];
  filteredGroups: GroupInfo[];
  searchQuery: string;
  groupNames: Set<string>;
  expanded: Set<string>;
  onToggle: (name: string) => void;
  onEdit: (group: GroupInfo) => void;
  onDelete: (group: GroupInfo) => void;
}) {
  return (
    <Stack
      spacing={0.85}
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        pr: 0.25,
        pb: 2,
        // Keep the last expanded card fully scrollable into view
        scrollPaddingBottom: 24
      }}
    >
      {searchQuery.trim() && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.25, flexShrink: 0 }}>
          {filteredGroups.length} of {groups.length} {groups.length === 1 ? "group" : "groups"}
        </Typography>
      )}
      {filteredGroups.map((group) => (
        <GroupCard
          key={group.name}
          group={group}
          groupNames={groupNames}
          expanded={expanded.has(group.name)}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </Stack>
  );
}

function DeleteGroupDialog({ deleteTarget, deleteReferences, saving, onCancel, onConfirm }: {
  deleteTarget: GroupInfo | null;
  deleteReferences: string[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={deleteTarget !== null} onClose={() => !saving && onCancel()} maxWidth="xs" fullWidth>
      <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">The nodes are kept. Only the shared group definition is removed.</Typography>
        {deleteReferences.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            It is nested inside {deleteReferences.join(", ")}; those references will also be removed.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={saving}>
          Delete group
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface GroupsPanelProps {
  sessionId: string;
  onChanged: () => void;
}

export function GroupsPanel({ sessionId, onChanged }: GroupsPanelProps) {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [nodeNames, setNodeNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GroupInfo | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canvasNodes = useNodes();
  const selectedNodeIds = useMemo(() => canvasNodes.filter((node) => node.selected).map((node) => node.id), [canvasNodes]);
  const BASE = getApiBase();

  const apply = useCallback((data: GroupsPayload) => {
    setGroups(data.groups ?? []);
    setNodeNames(data.nodes ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE}/api/topology/groups?sessionId=${sessionId}`);
      if (!response.ok) throw new Error("Could not load groups");
      apply(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [BASE, sessionId, apply]);

  useEffect(() => { void load(); }, [load]);

  // Keep expanded set in sync when groups are removed.
  useEffect(() => {
    setExpanded((current) => {
      const names = new Set(groups.map((g) => g.name));
      const next = new Set([...current].filter((name) => names.has(name)));
      return next.size === current.size ? current : next;
    });
  }, [groups]);

  // Auto-expand matches while searching so results are visible without extra clicks.
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const matches = groups
      .filter((group) => [group.name, ...group.members, ...group.module].some((value) => value.toLowerCase().includes(query)))
      .map((group) => group.name);
    if (matches.length > 0 && matches.length <= 8) {
      setExpanded(new Set(matches));
    }
  }, [searchQuery, groups]);

  const openCreate = (event: React.MouseEvent<HTMLElement>) => {
    blurTrigger(event.currentTarget);
    setError(null);
    setEditingGroup(null);
    setEditorOpen(true);
  };

  const saveGroup = async (group: GroupInfo) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${BASE}/api/topology/groups?sessionId=${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group)
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "Could not save the group");
      }
      apply(await response.json());
      setEditorOpen(false);
      setExpanded((current) => new Set(current).add(group.name));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const response = await fetch(`${BASE}/api/topology/groups/${encodeURIComponent(deleteTarget.name)}?sessionId=${sessionId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete the group");
      apply(await response.json());
      setDeleteTarget(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteReferences = deleteTarget
    ? groups.filter((group) => group.members.includes(deleteTarget.name)).map((group) => group.name)
    : [];

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => [group.name, ...group.members, ...group.module].some((value) => value.toLowerCase().includes(query)));
  }, [groups, searchQuery]);

  const groupNames = useMemo(() => new Set(groups.map((g) => g.name)), [groups]);

  const allExpanded = filteredGroups.length > 0 && filteredGroups.every((g) => expanded.has(g.name));

  let listView: "loading" | "empty" | "list" = "list";
  if (loading) listView = "loading";
  else if (filteredGroups.length === 0) listView = "empty";

  const toggleGroup = (name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filteredGroups.map((g) => g.name)));
  const collapseAll = () => setExpanded(new Set());

  return (
    <Box
      sx={{
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.25,
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        boxSizing: "border-box"
      }}
    >
      <GroupsHeader groupCount={groups.length} selectedNodeCount={selectedNodeIds.length} onCreate={openCreate} />

      {groups.length > 0 && (
        <GroupsSearchBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showExpandToggle={filteredGroups.length > 1}
          allExpanded={allExpanded}
          onToggleExpandAll={allExpanded ? collapseAll : expandAll}
        />
      )}

      {error && !editorOpen && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ flexShrink: 0 }}>{error}</Alert>
      )}

      {listView === "loading" && (
        <Box sx={{ display: "grid", placeItems: "center", py: 5, flex: 1 }}>
          <CircularProgress size={22} />
        </Box>
      )}
      {listView === "empty" && <GroupsEmptyState hasGroups={groups.length > 0} onCreate={openCreate} />}
      {listView === "list" && (
        <GroupsList
          groups={groups}
          filteredGroups={filteredGroups}
          searchQuery={searchQuery}
          groupNames={groupNames}
          expanded={expanded}
          onToggle={toggleGroup}
          onEdit={(g) => { setError(null); setEditingGroup(g); setEditorOpen(true); }}
          onDelete={setDeleteTarget}
        />
      )}

      <GroupEditorDialog
        open={editorOpen}
        original={editingGroup}
        groups={groups}
        nodes={nodeNames}
        selectedNodes={selectedNodeIds}
        saving={saving}
        error={error}
        onClose={() => { setEditorOpen(false); setError(null); }}
        onSave={(group) => void saveGroup(group)}
      />

      <DeleteGroupDialog
        deleteTarget={deleteTarget}
        deleteReferences={deleteReferences}
        saving={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void deleteGroup()}
      />
    </Box>
  );
}
