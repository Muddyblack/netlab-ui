import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";

import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import { api, type AssistantProvider, type AssistantProviderSettings } from "../../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  /** All providers from capabilities. */
  providers: AssistantProvider[];
  /** Provider selected in the assistant header when settings were opened. */
  initialProviderId?: string;
  /** Called after a save/clear so the caller can re-probe capabilities. */
  onChanged: () => void;
}

const PROVIDER_KEY_CONFIG: Record<string, { url: string; label: string }> = {
  gemini: {
    url: "https://aistudio.google.com/app/apikey",
    label: "Get API key from Google AI Studio",
  },
  openai: {
    url: "https://platform.openai.com/api-keys",
    label: "Get API key from OpenAI Platform",
  },
  grok: {
    url: "https://console.x.ai/",
    label: "Get API key from xAI Console",
  },
  deepseek: {
    url: "https://platform.deepseek.com/api_keys",
    label: "Get API key from DeepSeek Platform",
  },
  kimi: {
    url: "https://platform.moonshot.cn/console/api-keys",
    label: "Get API key from Moonshot Console",
  },
  glm: {
    url: "https://z.ai/manage-apikey",
    label: "Get API key from Z.ai Console",
  },
  openai_compat: {
    url: "https://openrouter.ai/keys",
    label: "Get API key from OpenRouter",
  },
  claude: {
    url: "https://console.anthropic.com/",
    label: "Get access from Anthropic Console",
  },
  codex: {
    url: "https://platform.openai.com/",
    label: "Get access from OpenAI Platform",
  },
};

/**
 * The "AI providers" overview: every provider's connection status in one place,
 * plus the API-key / base-URL form for the direct-API providers. CLI providers
 * (Claude Code, Codex) have nothing to configure here — they use the login you
 * already have — so they show status and guidance only.
 */
export function ProviderSettingsDialog({
  open,
  onClose,
  providers,
  initialProviderId,
  onChanged,
}: Props) {
  // Show every provider, CLI agents first so their availability is front and
  // centre; configurable API providers follow.
  const ordered = useMemo(() => {
    const cli = providers.filter((p) => !p.configurable);
    const cfg = providers.filter((p) => p.configurable);
    return [...cli, ...cfg];
  }, [providers]);

  const [providerId, setProviderId] = useState(ordered[0]?.id ?? "gemini");
  const [settings, setSettings] = useState<AssistantProviderSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigurable = Boolean(providers.find((p) => p.id === providerId)?.configurable);
  const isOpenAiCompat = providerId === "openai_compat";

  const load = useCallback(
    (id: string) => {
      if (!providers.find((p) => p.id === id)?.configurable) {
        setSettings(null);
        setApiKey("");
        setBaseUrl("");
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      api
        .getAssistantProviderSettings(id)
        .then((value) => {
          setSettings(value);
          setApiKey("");
          setBaseUrl(value.baseUrl ?? "");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    },
    [providers]
  );

  useEffect(() => {
    if (!open) return;
    const id = ordered.some((provider) => provider.id === initialProviderId)
      ? initialProviderId!
      : ordered[0]?.id ?? "gemini";
    setProviderId(id);
    load(id);
  }, [ordered, initialProviderId, load, open]);

  const handleSwitchProvider = (id: string) => {
    setProviderId(id);
    load(id);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const values: { apiKey?: string; baseUrl?: string } = {};
      if (apiKey.trim()) values.apiKey = apiKey.trim();
      if (isOpenAiCompat && baseUrl.trim() !== (settings?.baseUrl ?? "")) {
        values.baseUrl = baseUrl.trim();
      }
      const updated = await api.putAssistantProviderSettings(providerId, values);
      setSettings(updated);
      setApiKey("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.putAssistantProviderSettings(providerId, { apiKey: "" });
      setSettings(updated);
      setApiKey("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const provider = ordered.find((p) => p.id === providerId);
  const keyEnvLocked = settings?.envLocked?.includes("apiKey") ?? false;
  const baseUrlEnvLocked = settings?.envLocked?.includes("baseUrl") ?? false;
  const connected = Boolean(settings?.hasApiKey) || Boolean(provider?.available);
  const nothingToSave =
    !apiKey.trim() &&
    (!isOpenAiCompat || baseUrl.trim() === (settings?.baseUrl ?? ""));

  const fallbackKeyConfig = PROVIDER_KEY_CONFIG[providerId];
  const keyUrl =
    (provider as (AssistantProvider & { apiKeyUrl?: string | null }) | undefined)
      ?.apiKeyUrl || fallbackKeyConfig?.url;
  const keyLabel =
    fallbackKeyConfig?.label ||
    (provider?.name ? `Get ${provider.name} API key` : "Get API key");

  let apiKeyHelper: string;
  if (keyEnvLocked) {
    apiKeyHelper = "Set by an environment variable on the backend — clear it there to edit here.";
  } else if (isOpenAiCompat) {
    apiKeyHelper = "Optional — local runtimes like Ollama ignore it; hosted gateways like OpenRouter need it.";
  } else {
    apiKeyHelper = "Stored on this machine only, never sent to other clients.";
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            backdropFilter: "blur(16px)",
            backgroundImage: "none",
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5, fontWeight: 600 }}>AI providers</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          netlab drives whichever agent you set up. CLI agents (Claude Code, Codex, Antigravity CLI) use the
          login you already have; Gemini and OpenAI use an API key stored only on this machine.
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="stretch">
          <Tabs
            orientation="vertical"
            value={providerId}
            onChange={(_event, value: string) => handleSwitchProvider(value)}
            variant="scrollable"
            sx={{
              minWidth: 168,
              borderRight: { sm: 1 },
              borderColor: { sm: "divider" },
              "& .MuiTab-root": {
                minHeight: 46,
                alignItems: "flex-start",
                textAlign: "left",
                textTransform: "none",
                px: 1,
                borderRadius: 1.5,
                mx: 0.25,
                transition: "background 120ms ease",
                "&:hover": { bgcolor: "action.hover" },
                "&.Mui-selected": { bgcolor: "action.selected" },
              },
              "& .MuiTabs-indicator": {
                left: 0,
                width: 3,
                borderRadius: 2,
                bgcolor: "warning.main",
              },
            }}
          >
            {ordered.map((p) => (
              <Tab
                key={p.id}
                value={p.id}
                disableRipple
                label={<ProviderTabLabel provider={p} />}
              />
            ))}
          </Tabs>

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 214 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ flex: 1 }}>
                {provider?.name}
                {provider?.version ? (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    {provider.version}
                  </Typography>
                ) : null}
              </Typography>
              <StatusPill connected={connected} />
            </Stack>

            {!isConfigurable ? (
              <Stack spacing={1.25}>
                <Typography variant="body2" color="text.secondary">
                  {provider?.available
                    ? "Ready to use — no key needed. It runs through the agent CLI you're already signed in to, so netlab never handles its credentials."
                    : "This agent isn't available yet. Install its CLI and sign in, then reopen the assistant:"}
                </Typography>
                {provider?.note && (
                  <Typography
                    variant="caption"
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: "divider",
                      bgcolor: "action.hover",
                      color: "text.secondary",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {provider.note}
                  </Typography>
                )}
                {provider?.available && provider?.takesModel && (
                  <Typography variant="caption" color="text.secondary">
                    Pick a model from the chat composer — leave it unset to use this CLI&apos;s own default.
                  </Typography>
                )}
                {keyUrl && (
                  <Button
                    component="a"
                    href={keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                    variant="outlined"
                    size="small"
                    sx={{
                      alignSelf: "flex-start",
                      textTransform: "none",
                      fontWeight: 500,
                      fontSize: "0.8125rem",
                      borderRadius: 1.5,
                    }}
                  >
                    {keyLabel}
                  </Button>
                )}
              </Stack>
            ) : (
              <Stack spacing={2}>
                {isOpenAiCompat && (
                  <TextField
                    size="small"
                    label="Base URL"
                    placeholder="http://localhost:11434/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={loading || saving || baseUrlEnvLocked}
                    helperText={
                      baseUrlEnvLocked
                        ? "Set by an environment variable on the backend."
                        : "Ollama, LM Studio, vLLM, OpenRouter, or another OpenAI-compatible endpoint."
                    }
                  />
                )}
                <TextField
                  size="small"
                  type="password"
                  label="API key"
                  placeholder={
                    settings?.hasApiKey
                      ? "•••••••••• (set — type a new key to replace)"
                      : "Paste your API key"
                  }
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={loading || saving || keyEnvLocked}
                  helperText={apiKeyHelper}
                />
                {keyUrl && (
                  <Button
                    component="a"
                    href={keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                    variant="outlined"
                    size="small"
                    color="warning"
                    sx={{
                      alignSelf: "flex-start",
                      textTransform: "none",
                      fontWeight: 500,
                      fontSize: "0.8125rem",
                      borderRadius: 1.5,
                      mt: -0.5,
                    }}
                  >
                    {keyLabel}
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  Pick the model from the chat composer once the key is saved.
                </Typography>
              </Stack>
            )}

            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        {isConfigurable && (
          <Button
            onClick={handleClearKey}
            color="error"
            disabled={saving || loading || !settings?.hasApiKey || keyEnvLocked}
            sx={{ textTransform: "none" }}
          >
            Remove key
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none" }}>
          Close
        </Button>
        {isConfigurable && (
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={saving || loading || nothingToSave}
            color="warning"
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function ProviderTabLabel({ provider }: { provider: AssistantProvider }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flexShrink: 0,
          bgcolor: provider.available ? "#4ade80" : "text.disabled",
          boxShadow: provider.available ? "0 0 6px rgba(74, 222, 128, 0.4)" : "none",
          transition: "all 200ms ease",
        }}
      />
      <Typography variant="body2" noWrap sx={{ flex: 1, textAlign: "left" }}>
        {provider.name}
      </Typography>
    </Stack>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{
        px: 1,
        py: 0.35,
        borderRadius: 2,
        bgcolor: connected ? "rgba(74, 222, 128, 0.12)" : "action.selected",
        border: "1px solid",
        borderColor: connected ? "rgba(74, 222, 128, 0.3)" : "divider",
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          bgcolor: connected ? "#4ade80" : "text.disabled",
          boxShadow: connected ? "0 0 4px rgba(74, 222, 128, 0.5)" : "none",
        }}
      />
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          color: connected ? "#4ade80" : "text.secondary",
          fontSize: "0.6875rem",
        }}
      >
        {connected ? "Connected" : "Not connected"}
      </Typography>
    </Stack>
  );
}
