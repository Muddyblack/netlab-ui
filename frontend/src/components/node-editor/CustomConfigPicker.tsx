import { useCallback, useEffect, useState } from "react";
import { Box, Button, Chip, IconButton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import { api, type CustomConfigs } from "../../api/client";
import { openLabFile } from "../../host/fileOpenStore";

type Template = CustomConfigs["templates"][number];

const SOURCE_LABEL: Record<string, string> = { lab: "this lab", user: "~/.netlab", system: "/etc/netlab" };

function coversDevice(template: Template, device: string): boolean {
  return !device || template.variants.some((variant) => variant === "any device" || variant === device || variant.endsWith(`.${device}`) || variant.startsWith(`${device}-`));
}

/** The custom configs netlab would find for `config: [name]`, one click to
 * add, plus "new template" that creates <name>/<device>.j2 and opens it. */
export function CustomConfigPicker({ sessionId, device, selected, onAdd }: {
  sessionId: string | null;
  /** The node's device ("" when it uses the lab default). */
  device: string;
  selected: string[];
  onAdd: (name: string) => void;
}) {
  const [data, setData] = useState<CustomConfigs | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      setData(await api.getCustomConfigs(sessionId));
    } catch {
      setData(null);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  const nodeDevice = device || data?.defaultDevice || "";

  const create = async () => {
    if (!sessionId || !name.trim()) return;
    setError(null);
    try {
      const { path } = await api.createCustomConfig(sessionId, name.trim(), nodeDevice);
      if (!selected.includes(name.trim())) onAdd(name.trim());
      setName("");
      openLabFile(path);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const templates = data?.templates ?? [];
  const available = templates.filter((template) => !selected.includes(template.name));
  return (
    <Stack spacing={1.5} sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
      {available.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">Templates netlab finds — click to add</Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {available.map((template) => {
              const fits = coversDevice(template, nodeDevice);
              const where = SOURCE_LABEL[template.source] ?? template.source;
              return (
                <Stack key={template.name} direction="row" alignItems="center">
                  <Tooltip describeChild
                    title={`${template.path} (${where}) · variants: ${template.variants.join(", ")}${fits ? "" : ` — none for ${nodeDevice}`}`}>
                    <Chip size="small" variant="outlined" label={template.name} onClick={() => onAdd(template.name)}
                      icon={fits ? <AddIcon /> : <WarningAmberIcon color="warning" />} />
                  </Tooltip>
                  {template.editable && (
                    <IconButton size="small" aria-label={`Edit ${template.name}`} onClick={() => openLabFile(template.path)}>
                      <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  )}
                </Stack>
              );
            })}
          </Stack>
        </Box>
      )}
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField size="small" label="New template" placeholder="e.g. ospf-tweaks" value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }}
          error={Boolean(error)} helperText={error ?? `Creates ${name.trim() || "<name>"}/${nodeDevice || "<device>"}.j2 in the lab and opens it`}
          sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" disabled={!name.trim() || !sessionId} onClick={() => void create()} sx={{ mt: 0.5 }}>
          Create
        </Button>
      </Stack>
    </Stack>
  );
}
