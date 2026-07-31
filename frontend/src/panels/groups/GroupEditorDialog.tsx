import { useEffect, useMemo, useState } from "react";
import {
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

import { KeyValueList, PanelSection } from "@srl-labs/clab-ui";
import { ModuleAttributeForms } from "../../components/module-editor/ModuleAttributeForms";
import type { GroupInfo, MemberOption } from "./types";
import { MODULE_SECTIONS, STRUCTURED_MODULES, attrsToStrings, groupContains, isStructuredAttribute, parseAttributeValue } from "./helpers";

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
  const attributeStrings = attrsToStrings(Object.fromEntries(Object.entries(draft.attrs).filter(([key]) => !isStructuredAttribute(key))));
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
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2.25, py: 2.25 }}>
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

        <PanelSection title={`Members · ${draft.members.length}`} withTopDivider={false} bodySx={{ px: 0, pt: 1 }}>
          <Stack direction="row" spacing={0.75} sx={{ mb: 1, flexWrap: "wrap", rowGap: 0.75 }}>
            <Button size="small" variant="outlined" disabled={selectedNodes.length === 0} onClick={() => setDraft((current) => ({ ...current, members: [...selectedNodes] }))}>
              Use canvas selection{selectedNodes.length ? ` (${selectedNodes.length})` : ""}
            </Button>
            <Button size="small" onClick={() => setDraft((current) => ({ ...current, members: [...nodes] }))}>All nodes</Button>
            <Button size="small" color="inherit" disabled={draft.members.length === 0} onClick={() => setDraft((current) => ({ ...current, members: [] }))}>Clear</Button>
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
        </PanelSection>

        <PanelSection title={`Modules · ${draft.module.length}`} bodySx={{ px: 0, pt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Click modules to enable them for every member.</Typography>
          <Stack spacing={1.25}>
            {MODULE_SECTIONS.map((section) => (
              <Box key={section.label}>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.7 }}>{section.label}</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.65 }}>
                  {section.modules.map((module) => (
                    <Chip key={module} size="small" clickable color={draft.module.includes(module) ? "primary" : "default"} variant={draft.module.includes(module) ? "filled" : "outlined"} label={module} onClick={() => toggleModule(module)} />
                  ))}
                </Box>
              </Box>
            ))}
          </Stack>
        </PanelSection>

        {draft.module.some((module) => STRUCTURED_MODULES.has(module)) && (
          <PanelSection title="Module settings" bodySx={{ px: 0, pt: 1 }}>
            <ModuleAttributeForms modules={draft.module} attrs={draft.attrs} onChange={(attrs) => setDraft((current) => ({ ...current, attrs }))} />
          </PanelSection>
        )}

        <PanelSection title={`Other attributes · ${Object.keys(attributeStrings).length}`} bodySx={{ px: 0, pt: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Use this for plugin settings and less common netlab attributes.</Typography>
          <KeyValueList
            items={attributeStrings}
            onChange={(items) => setDraft((current) => ({
              ...current,
              attrs: {
                ...Object.fromEntries(Object.entries(current.attrs).filter(([key]) => isStructuredAttribute(key))),
                ...Object.fromEntries(Object.entries(items).filter(([key]) => key.trim()).map(([key, value]) => [key.trim(), parseAttributeValue(value)]))
              }
            }))}
            keyPlaceholder="Attribute, e.g. evpn.transit_vni"
            valuePlaceholder="Value (text, number, true/false, or JSON)"
          />
        </PanelSection>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" disabled={!canSave} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
          {saving ? <CircularProgress size={18} color="inherit" /> : saveButtonLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
