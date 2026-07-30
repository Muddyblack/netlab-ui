import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Card, Divider, Stack, TextField, Typography } from "@mui/material";
import { api, HttpError, type HealthStatus, type NetlabEnvironment } from "../../api/client";
import { RuntimeInfo } from "../NetlabAboutModal";

const TEXT_SECONDARY = "text.secondary";

function cleanVersion(value?: string | null): string {
  if (!value) return "not found";
  return value.replace(/^netlab version\s+/i, "").trim();
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color={TEXT_SECONDARY}>{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: "monospace", textAlign: "right", overflowWrap: "anywhere" }}>
        {value || "—"}
      </Typography>
    </Stack>
  );
}

function extractHttpErrorDetail(err: HttpError): string {
  try {
    const body = JSON.parse(err.message.slice(err.message.indexOf("{")));
    return body.detail || err.message;
  } catch {
    return err.message;
  }
}

function describeSaveError(err: unknown): string {
  if (err instanceof HttpError) return extractHttpErrorDetail(err);
  return err instanceof Error ? err.message : String(err);
}

export interface SettingsEnvironmentTabProps {
  active: boolean;
  onEnvironmentChanged: () => void;
  health: HealthStatus | null;
}

export function SettingsEnvironmentTab({ active, onEnvironmentChanged, health }: SettingsEnvironmentTabProps) {
  const [environment, setEnvironment] = useState<NetlabEnvironment | null>(null);
  const [envPath, setEnvPath] = useState("");
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  const loadEnvironment = useCallback(async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const next = await api.getNetlabEnvironment();
      setEnvironment(next);
      setEnvPath(next.configured || "");
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void loadEnvironment();
  }, [active, loadEnvironment]);

  const saveEnvironment = async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const next = await api.setNetlabPath(envPath.trim() || null);
      setEnvironment(next);
      setEnvPath(next.configured || "");
      onEnvironmentChanged();
    } catch (err) {
      setEnvError(describeSaveError(err));
    } finally {
      setEnvLoading(false);
    }
  };

  return (
    <Stack spacing={2.5}>
      {envError && <Alert severity="error">{envError}</Alert>}

      <Box>
        <Typography variant="subtitle2" fontWeight={650} gutterBottom>
          Netlab Executable Location
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          netlab and Ansible are not bundled with the UI backend. Select the netlab executable
          you already use, including one installed by pipx or in another virtual environment.
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="Auto-detect netlab in PATH"
            value={envPath}
            onChange={(e) => setEnvPath(e.target.value)}
            disabled={envLoading}
            helperText="Leave empty to use automatic PATH resolution"
          />
          <Button variant="contained" onClick={() => void saveEnvironment()} disabled={envLoading}>
            Save
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={650} gutterBottom>
          Resolved Environment Details
        </Typography>
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.25}>
            <InfoRow label="Netlab executable" value={environment?.binPath || environment?.command} />
            <InfoRow label="Netlab version" value={cleanVersion(environment?.netlabVersion)} />
            <InfoRow label="Resolution source" value={environment?.source} />
            <InfoRow label="Target Python" value={environment?.targetPython} />
            <InfoRow label="Netlab config path" value={environment?.configPath} />
          </Stack>
        </Card>
      </Box>

      <Divider />

      <RuntimeInfo health={health} />
    </Stack>
  );
}
