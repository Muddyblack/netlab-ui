import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemText,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { KeyValueList } from "@containerlab/clab-ui";
import { ModuleAttributeForms } from "../../components/module-editor/ModuleAttributeForms";
import { ModulePicker } from "../../components/module-editor/ModulePicker";
import type { GroupInfo, MemberOption } from "./types";
import { STRUCTURED_MODULES, attrsToStrings, groupContains, isStructuredAttribute, parseAttributeValue } from "./helpers";

const GROUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isInvalidGroupName(name: string): boolean {
  return Boolean(name) && !GROUP_NAME_PATTERN.test(name);
}

function getNameHelperText(nameTaken: boolean, invalidName: boolean, editing: boolean): string {
  if (nameTaken) return "A group with this name already exists.";
  if (invalidName) return "Use letters, numbers, dots, dashes, or underscores.";
  if (editing) return "Group names stay stable so nested references do not break.";
  return "Use a short YAML-safe name, for example edge_routers.";
}

function useGroupDraft(open: boolean, original: GroupInfo | null, selectedNodes: string[]) {
  const [draft, setDraft] = useState<GroupInfo>({ name: "", members: [], module: [], attrs: {} });

  useEffect(() => {
    if (!open) return;
    setDraft(original
      ? { ...original, members: [...original.members], module: [...original.module], attrs: { ...original.attrs } }
      : { name: "", members: [...selectedNodes], module: [], attrs: {} });
  }, [open, original, selectedNodes]);

  return [draft, setDraft] as const;
}

function useMemberOptions(nodes: string[], groups: GroupInfo[], draftName: string) {
  const options = useMemo<MemberOption[]>(() => [
    ...nodes.map((name) => ({ name, kind: "Node" as const })),
    ...groups
      .filter((group) => group.name !== draftName && !groupContains(groups, group.name, draftName))
      .map((group) => ({ name: group.name, kind: "Nested group" as const }))
  ], [draftName, groups, nodes]);
  const optionByName = useMemo(() => new Map(options.map((option) => [option.name, option])), [options]);
  return { options, optionByName };
}

/** Plugin settings and less common attributes, folded away until there are some. */
function OtherAttributes({ attrs, onChange }: { attrs: Record<string, unknown>; onChange: (attrs: Record<string, unknown>) => void }) {
  const items = attrsToStrings(Object.fromEntries(Object.entries(attrs).filter(([key]) => !isStructuredAttribute(key))));
  const count = Object.keys(items).length;
  return (
    <Accordion disableGutters elevation={0} defaultExpanded={count > 0} sx={{ bgcolor: "transparent", "&:before": { display: "none" }, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">Other attributes{count ? ` · ${count}` : ""}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Plugin settings and less common netlab attributes.</Typography>
        <KeyValueList
          items={items}
          onChange={(next) => onChange({
            ...Object.fromEntries(Object.entries(attrs).filter(([key]) => isStructuredAttribute(key))),
            ...Object.fromEntries(Object.entries(next).filter(([key]) => key.trim()).map(([key, value]) => [key.trim(), parseAttributeValue(value)]))
          })}
          keyPlaceholder="Attribute, e.g. evpn.transit_vni"
          valuePlaceholder="Value (text, number, true/false, or JSON)"
        />
      </AccordionDetails>
    </Accordion>
  );
}

export function GroupEditorDialog({
  open,
  original,
  groups,
  nodes,
  selectedNodes,
  saving,
  error,
  onClose,
  onSave
}: {
  open: boolean;
  original: GroupInfo | null;
  groups: GroupInfo[];
  nodes: string[];
  selectedNodes: string[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (group: GroupInfo) => void;
}) {
  const editing = original !== null;
  const [draft, setDraft] = useGroupDraft(open, original, selectedNodes);
  const { options, optionByName } = useMemberOptions(nodes, groups, draft.name);
  const selectedOptions = draft.members.map((name) => optionByName.get(name) ?? { name, kind: "Node" as const });
  const nameTaken = !editing && groups.some((group) => group.name === draft.name.trim());
  const invalidName = isInvalidGroupName(draft.name.trim());
  const canSave = !saving && Boolean(draft.name.trim()) && !nameTaken && !invalidName;

  const saveButtonLabel = editing ? "Save changes" : "Create group";
  const nameHelperText = getNameHelperText(nameTaken, invalidName, editing);

  const toggleModule = (module: string) => {
    setDraft((current) => ({
      ...current,
      module: current.module.includes(module)
        ? current.module.filter((item) => item !== module)
        : [...current.module, module]
    }));
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar sx={{ width: 36, height: 36, bgcolor: "primary.main" }}><AccountTreeIcon fontSize="small" /></Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.15 }}>{editing ? `Edit ${original.name}` : "Create a group"}</Typography>
            <Typography variant="caption" color="text.secondary">Share modules and settings across nodes or nested groups.</Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2.5, py: 2.25 }}>
        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          autoFocus={!editing}
          label="Group name"
          size="small"
          value={draft.name}
          disabled={editing}
          error={nameTaken || invalidName}
          helperText={nameHelperText}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          fullWidth
        />

        <Box>
          <Stack direction="row" alignItems="center" sx={{ mb: 0.75 }}>
            <Typography variant="subtitle2" sx={{ flex: 1 }}>Members{draft.members.length ? ` · ${draft.members.length}` : ""}</Typography>
            <Button size="small" variant="text" disabled={selectedNodes.length === 0} onClick={() => setDraft((current) => ({ ...current, members: [...selectedNodes] }))}>
              Canvas selection{selectedNodes.length ? ` (${selectedNodes.length})` : ""}
            </Button>
            <Button size="small" variant="text" onClick={() => setDraft((current) => ({ ...current, members: [...nodes] }))}>All</Button>
            <Button size="small" variant="text" disabled={draft.members.length === 0} onClick={() => setDraft((current) => ({ ...current, members: [] }))}>Clear</Button>
          </Stack>
          <Autocomplete
            multiple
            disableCloseOnSelect
            size="small"
            options={options}
            groupBy={(option) => option.kind}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.name === value.name}
            value={selectedOptions}
            onChange={(_event, value) => setDraft((current) => ({ ...current, members: value.map((item) => item.name) }))}
            renderOption={(props, option, state) => (
              <li {...props} key={`${option.kind}:${option.name}`}>
                <Checkbox size="small" checked={state.selected} sx={{ mr: 1, p: 0 }} />
                <ListItemText primary={option.name} secondary={option.kind === "Nested group" ? "Includes all members of this group" : undefined} />
              </li>
            )}
            renderTags={(value, getTagProps) => value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option.name}
                size="small"
                variant={option.kind === "Nested group" ? "outlined" : "filled"}
                icon={option.kind === "Nested group" ? <AccountTreeIcon /> : undefined}
                label={option.name}
              />
            ))}
            renderInput={(params) => <TextField {...params} placeholder={draft.members.length ? "Add more…" : "Choose nodes or groups…"} />}
          />
        </Box>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Modules{draft.module.length ? ` · ${draft.module.length}` : ""}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>Enabled for every member.</Typography>
          <ModulePicker selected={draft.module} onToggle={toggleModule} onClear={() => setDraft((current) => ({ ...current, module: [] }))} />
        </Box>

        {draft.module.some((module) => STRUCTURED_MODULES.has(module)) && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Module settings</Typography>
            <ModuleAttributeForms modules={draft.module} attrs={draft.attrs} onChange={(attrs) => setDraft((current) => ({ ...current, attrs }))} />
          </Box>
        )}

        <OtherAttributes attrs={draft.attrs} onChange={(attrs) => setDraft((current) => ({ ...current, attrs }))} />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button variant="text" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
          {saving ? <CircularProgress size={18} color="inherit" /> : saveButtonLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
