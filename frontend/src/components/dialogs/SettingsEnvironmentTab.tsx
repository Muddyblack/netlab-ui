import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Card, Divider, Stack, TextField, Typography } from "@mui/material";
import { api, HttpError, type HealthStatus, type NetlabEnvironment } from "../../api/client";
import { RuntimeInfo } from "../NetlabAboutModal";
import { ManagedNetlabCard } from "../ManagedNetlabCard";
import { NetlabSetupHelpers } from "../NetlabSetupHelpers";
import { ProviderSupportTable } from "../ProviderSupportTable";
import { ContainerSetupPanel } from "../ContainerSetup";
import { HostSetupPanel } from "../HostSetup";

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

const SOURCE_LABELS: Record<string, string> = {
  config: "chosen here (Settings)",
  env: "NETLAB_BIN environment variable",
  path: "first netlab on PATH",
  default: "not found",
};

export interface SettingsEnvironmentTabProps {
  active: boolean;
  onEnvironmentChanged: () => void;
  health: HealthStatus | null;
}

/** Which netlab the backend runs, and from where (all of it as resolved, read-only). */
function ResolvedEnvironment({ environment }: { environment: NetlabEnvironment | null }) {
  const env: Partial<NetlabEnvironment> = environment ?? {};
  const toolEnv = Object.entries(env.toolEnv ?? {}).map(([k, v]) => `${k}=${v}`).join("  ");
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={650} gutterBottom>
        Resolved Environment Details
      </Typography>
      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.25}>
          <InfoRow label="Netlab executable" value={env.binPath || env.command} />
          <InfoRow label="Netlab version" value={cleanVersion(env.netlabVersion)} />
          <InfoRow label="Resolution source" value={SOURCE_LABELS[env.source ?? ""] ?? env.source} />
          <InfoRow label="netsim package" value={env.netsimDir} />
          <InfoRow label="netsim version" value={cleanVersion(env.netsimVersion)} />
          <InfoRow label="Extra environment" value={toolEnv || undefined} />
          <InfoRow label="Target Python" value={env.targetPython} />
          <InfoRow label="Netlab config path" value={env.configPath} />
        </Stack>
      </Card>
    </Box>
  );
}

/** The netlab executable to use; empty means the first netlab on PATH. */
function NetlabPathField({ value, onChange, busy, onSave }: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSave: () => void;
}) {
  return (
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
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          helperText="Leave empty to use automatic PATH resolution"
        />
        <Button variant="contained" onClick={onSave} disabled={busy}>
          Save
        </Button>
      </Stack>
    </Box>
  );
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

      {(environment?.warnings ?? []).map((warning) => (
        <Alert key={warning} severity="warning">
          {warning}
        </Alert>
      ))}

      {environment && !environment.found && (
        <ManagedNetlabCard
          netlabFound={false}
          onChanged={() => {
            void loadEnvironment();
            onEnvironmentChanged();
          }}
        />
      )}

      <ContainerSetupPanel active={active} />
      <HostSetupPanel active={active} />

      <NetlabPathField value={envPath} onChange={setEnvPath} busy={envLoading} onSave={() => void saveEnvironment()} />

      {environment?.found && (
        <ManagedNetlabCard
          netlabFound
          onChanged={() => {
            void loadEnvironment();
            onEnvironmentChanged();
          }}
        />
      )}

      <Divider />

      <ResolvedEnvironment environment={environment} />

      <Divider />

      <RuntimeInfo health={health} />

      <Divider />

      <ProviderSupportTable />

      <Divider />

      <NetlabSetupHelpers />
    </Stack>
  );
}
