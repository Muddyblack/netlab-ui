import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
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

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** All providers from capabilities. */
  providers: AssistantProvider[];
  /** Provider selected in the assistant header when settings were opened. */
  initialProviderId?: string;
  /** Called after a save/clear so the caller can re-probe capabilities. */
  onChanged: () => void;
}

interface PanelProps {
  /** All providers from capabilities. */
  providers: AssistantProvider[];
  /** Provider selected when the panel was opened. */
  initialProviderId?: string;
  /** Called after a save/clear so the caller can re-probe capabilities. */
  onChanged: () => void;
  /** True while the panel is actually visible — (re)loads the active
   * provider's settings each time it becomes visible. */
  active: boolean;
  /** Omit to hide the "Close" button (e.g. embedded in a Settings tab that
   * already has its own "Done" button). */
  onClose?: () => void;
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
 * The "AI providers" overview as a standalone dialog — thin wrapper around
 * {@link ProviderSettingsPanel}. Also embedded directly as a Settings tab
 * (see `SettingsDialog`'s "Assistant" tab) so provider/API-key setup stays
 * reachable from the gear icon even when the assistant chat panel itself
 * isn't showing (its palette tab is owned by clab-ui and isn't always
 * selectable — see `App.tsx`'s `customPaletteTabs` comment).
 */
export function ProviderSettingsDialog({
  open,
  onClose,
  providers,
  initialProviderId,
  onChanged,
}: DialogProps) {
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
      <ProviderSettingsPanel
        providers={providers}
        initialProviderId={initialProviderId}
        onChanged={onChanged}
        active={open}
        onClose={onClose}
      />
    </Dialog>
  );
}

function useOrderedProviders(providers: AssistantProvider[]) {
  // Show every provider, CLI agents first so their availability is front and
  // centre; configurable API providers follow.
  return useMemo(() => {
    const cli = providers.filter((p) => !p.configurable);
    const cfg = providers.filter((p) => p.configurable);
    return [...cli, ...cfg];
  }, [providers]);
}

function isKnownConfigurableProvider(providers: AssistantProvider[], id: string): boolean {
  return Boolean(providers.find((p) => p.id === id)?.configurable || PROVIDER_KEY_CONFIG[id]);
}

function useProviderSettingsLoader(providers: AssistantProvider[], ordered: AssistantProvider[], active: boolean, initialProviderId?: string) {
  const [providerId, setProviderId] = useState(ordered[0]?.id ?? "gemini");
  const [settings, setSettings] = useState<AssistantProviderSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (id: string) => {
      // A current assistant backend always reports every registered provider,
      // including unavailable ones. An empty catalog means this frontend is
      // connected to an older backend; don't manufacture a Gemini selection
      // and then call endpoints that backend cannot have.
      if (providers.length === 0 || !isKnownConfigurableProvider(providers, id)) {
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
    if (!active) return;
    const id = ordered.some((provider) => provider.id === initialProviderId)
      ? initialProviderId!
      : ordered[0]?.id ?? "gemini";
    setProviderId(id);
    load(id);
  }, [ordered, initialProviderId, load, active]);

  const handleSwitchProvider = (id: string) => {
    setProviderId(id);
    load(id);
  };

  return { providerId, settings, setSettings, apiKey, setApiKey, baseUrl, setBaseUrl, loading, error, setError, handleSwitchProvider };
}

function useProviderSaveActions(
  providerId: string,
  onChanged: () => void,
  setSettings: (value: AssistantProviderSettings) => void,
  setApiKey: (value: string) => void,
  setError: (value: string | null) => void
) {
  const [saving, setSaving] = useState(false);

  const putSettings = useCallback(
    async (values: { apiKey?: string; baseUrl?: string }) => {
      setSaving(true);
      setError(null);
      try {
        const updated = await api.putAssistantProviderSettings(providerId, values);
        setSettings(updated);
        setApiKey("");
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [providerId, onChanged, setSettings, setApiKey, setError]
  );

  return { saving, putSettings };
}

function buildSaveValues(apiKey: string, isOpenAiCompat: boolean, baseUrl: string, currentBaseUrl: string) {
  const values: { apiKey?: string; baseUrl?: string } = {};
  if (apiKey.trim()) values.apiKey = apiKey.trim();
  if (isOpenAiCompat && baseUrl.trim() !== currentBaseUrl) values.baseUrl = baseUrl.trim();
  return values;
}

function computeIsConfigurable(provider: AssistantProvider | undefined, providerId: string): boolean {
  const fallback = PROVIDER_KEY_CONFIG[providerId];
  return Boolean(provider?.configurable || fallback);
}

function computeEnvLocks(settings: AssistantProviderSettings | null) {
  const envLocked = settings?.envLocked ?? [];
  return {
    keyEnvLocked: envLocked.includes("apiKey"),
    baseUrlEnvLocked: envLocked.includes("baseUrl"),
  };
}

function computeConnected(settings: AssistantProviderSettings | null, provider: AssistantProvider | undefined): boolean {
  const hasApiKey = settings?.hasApiKey ?? false;
  const available = provider?.available ?? false;
  return hasApiKey || available;
}

function computeNothingToSave(apiKey: string, isOpenAiCompat: boolean, baseUrl: string, settings: AssistantProviderSettings | null): boolean {
  if (apiKey.trim()) return false;
  if (!isOpenAiCompat) return true;
  const currentBaseUrl = settings?.baseUrl ?? "";
  return baseUrl.trim() === currentBaseUrl;
}

function computeKeyUrlAndLabel(provider: AssistantProvider | undefined, providerId: string) {
  const fallbackKeyConfig = PROVIDER_KEY_CONFIG[providerId];
  const providerKeyUrl = (provider as (AssistantProvider & { apiKeyUrl?: string | null }) | undefined)?.apiKeyUrl;
  const keyUrl = providerKeyUrl || fallbackKeyConfig?.url;
  const keyLabel = fallbackKeyConfig?.label ?? (provider?.name ? `Get ${provider.name} API key` : "Get API key");
  return { keyUrl, keyLabel };
}

function useProviderSettingsState({ providers, initialProviderId, onChanged, active }: PanelProps) {
  const ordered = useOrderedProviders(providers);
  const { providerId, settings, setSettings, apiKey, setApiKey, baseUrl, setBaseUrl, loading, error, setError, handleSwitchProvider } =
    useProviderSettingsLoader(providers, ordered, active, initialProviderId);

  const provider = ordered.find((p) => p.id === providerId);
  // Older backend instances did not include `configurable` in their
  // capabilities response. Keep this client-side fallback so Gemini/OpenAI
  // never degrade into the nonsensical "install its CLI" view during an
  // upgrade or a temporarily stale response.
  const isConfigurable = computeIsConfigurable(provider, providerId);
  const isOpenAiCompat = provider?.id === "openai_compat";

  const { saving, putSettings } = useProviderSaveActions(providerId, onChanged, setSettings, setApiKey, setError);
  const handleSave = useCallback(
    () => putSettings(buildSaveValues(apiKey, isOpenAiCompat, baseUrl, settings?.baseUrl ?? "")),
    [apiKey, isOpenAiCompat, baseUrl, settings, putSettings]
  );
  const handleClearKey = useCallback(() => putSettings({ apiKey: "" }), [putSettings]);

  const { keyEnvLocked, baseUrlEnvLocked } = computeEnvLocks(settings);
  const connected = computeConnected(settings, provider);
  const nothingToSave = computeNothingToSave(apiKey, isOpenAiCompat, baseUrl, settings);
  const { keyUrl, keyLabel } = computeKeyUrlAndLabel(provider, providerId);
  const apiKeyHelper = describeApiKeyHelper(keyEnvLocked, isOpenAiCompat);

  return {
    ordered,
    providerId,
    provider,
    isConfigurable,
    isOpenAiCompat,
    settings,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    loading,
    saving,
    error,
    setError,
    handleSwitchProvider,
    handleSave,
    handleClearKey,
    keyEnvLocked,
    baseUrlEnvLocked,
    connected,
    nothingToSave,
    keyUrl,
    keyLabel,
    apiKeyHelper,
  };
}

export function ProviderSettingsPanel(props: PanelProps) {
  const { onClose, onChanged } = props;
  const {
    ordered,
    providerId,
    provider,
    isConfigurable,
    isOpenAiCompat,
    settings,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    loading,
    saving,
    error,
    setError,
    handleSwitchProvider,
    handleSave,
    handleClearKey,
    keyEnvLocked,
    baseUrlEnvLocked,
    connected,
    nothingToSave,
    keyUrl,
    keyLabel,
    apiKeyHelper,
  } = useProviderSettingsState(props);

  return (
    <>
      <DialogContent dividers sx={{ px: 0, pt: 0 }}>
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
            <ProviderHeader provider={provider} connected={connected} />
            <ProviderBody
              provider={provider}
              isConfigurable={isConfigurable}
              onChanged={onChanged}
              isOpenAiCompat={isOpenAiCompat}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              baseUrlEnvLocked={baseUrlEnvLocked}
              apiKey={apiKey}
              setApiKey={setApiKey}
              apiKeyHelper={apiKeyHelper}
              keyEnvLocked={keyEnvLocked}
              hasApiKey={Boolean(settings?.hasApiKey)}
              keyUrl={keyUrl}
              keyLabel={keyLabel}
              loading={loading}
              saving={saving}
            />
            {error && (
              <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <ProviderSettingsFooter
        isConfigurable={isConfigurable}
        provider={provider}
        onClose={onClose}
        onClearKey={() => void handleClearKey()}
        onSave={() => void handleSave()}
        saving={saving}
        loading={loading}
        hasApiKey={Boolean(settings?.hasApiKey)}
        keyEnvLocked={keyEnvLocked}
        nothingToSave={nothingToSave}
      />
    </>
  );
}

function describeApiKeyHelper(keyEnvLocked: boolean, isOpenAiCompat: boolean): string {
  if (keyEnvLocked) return "Set by an environment variable on the backend — clear it there to edit here.";
  if (isOpenAiCompat) return "Optional — local runtimes like Ollama ignore it; hosted gateways like OpenRouter need it.";
  return "Stored on this machine only, never sent to other clients.";
}

function ProviderHeader({ provider, connected }: { provider?: AssistantProvider; connected: boolean }) {
  return (
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
  );
}

function ProviderBody({
  provider,
  isConfigurable,
  onChanged,
  ...configurableProps
}: {
  provider?: AssistantProvider;
  isConfigurable: boolean;
  onChanged: () => void;
} & Omit<Parameters<typeof ConfigurableProviderForm>[0], "provider">) {
  if (!provider) return <BackendOutOfDateAlert />;
  if (!isConfigurable) return <NonConfigurableProviderInfo provider={provider} onChanged={onChanged} />;
  return <ConfigurableProviderForm provider={provider} {...configurableProps} />;
}

function ProviderSettingsFooter({
  isConfigurable,
  provider,
  onClose,
  onClearKey,
  onSave,
  saving,
  loading,
  hasApiKey,
  keyEnvLocked,
  nothingToSave,
}: {
  isConfigurable: boolean;
  provider?: AssistantProvider;
  onClose?: () => void;
  onClearKey: () => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
  hasApiKey: boolean;
  keyEnvLocked: boolean;
  nothingToSave: boolean;
}) {
  const showProviderActions = isConfigurable && Boolean(provider);
  return (
    <Stack direction="row" spacing={1} sx={{ px: 0, py: 1.5 }}>
      {showProviderActions && (
        <Button
          onClick={onClearKey}
          color="error"
          disabled={saving || loading || !hasApiKey || keyEnvLocked}
          sx={{ textTransform: "none" }}
        >
          Remove key
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {onClose && (
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none" }}>
          Close
        </Button>
      )}
      {showProviderActions && (
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving || loading || nothingToSave}
          color="warning"
          sx={{ textTransform: "none", fontWeight: 600 }}
        >
          Save
        </Button>
      )}
    </Stack>
  );
}

function BackendOutOfDateAlert() {
  return (
    <Alert severity="error">
      <Typography variant="body2" fontWeight={600}>
        Assistant backend is out of date
      </Typography>
      <Typography variant="caption">
        The connected backend does not expose provider settings. Restart netlab-ui so its frontend and backend use
        the same version, then reload this page.
      </Typography>
    </Alert>
  );
}

function NonConfigurableProviderInfo({
  provider,
  onChanged,
}: {
  provider: AssistantProvider;
  onChanged: () => void;
}) {
  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary">
        {provider.available
          ? "Ready to use — no key needed. It runs through the agent CLI you're already signed in to, so netlab never handles its credentials."
          : "This CLI agent is not ready on this machine yet. Its current check result is below:"}
      </Typography>
      {provider.note && (
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
      {provider.available && provider.takesModel && (
        <Typography variant="caption" color="text.secondary">
          Pick a model from the chat composer — leave it unset to use this CLI&apos;s own default.
        </Typography>
      )}
      {!provider.available && (
        <Button variant="outlined" size="small" onClick={onChanged} sx={{ alignSelf: "flex-start", textTransform: "none" }}>
          Check again
        </Button>
      )}
    </Stack>
  );
}

function ConfigurableProviderForm({
  provider,
  isOpenAiCompat,
  baseUrl,
  setBaseUrl,
  baseUrlEnvLocked,
  apiKey,
  setApiKey,
  apiKeyHelper,
  keyEnvLocked,
  hasApiKey,
  keyUrl,
  keyLabel,
  loading,
  saving,
}: {
  provider: AssistantProvider;
  isOpenAiCompat: boolean;
  baseUrl: string;
  setBaseUrl: (value: string) => void;
  baseUrlEnvLocked: boolean;
  apiKey: string;
  setApiKey: (value: string) => void;
  apiKeyHelper: string;
  keyEnvLocked: boolean;
  hasApiKey: boolean;
  keyUrl?: string | null;
  keyLabel: string;
  loading: boolean;
  saving: boolean;
}) {
  return (
    <Stack spacing={2}>
      {!provider.available && provider.note && (
        <Alert severity="info">
          <Typography variant="body2">{provider.note}</Typography>
          <Typography variant="caption" color="text.secondary">
            Resolve the issue above, then save the settings below. netlab-ui will check this provider again.
          </Typography>
        </Alert>
      )}
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
        placeholder={hasApiKey ? "•••••••••• (set — type a new key to replace)" : "Paste your API key"}
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
