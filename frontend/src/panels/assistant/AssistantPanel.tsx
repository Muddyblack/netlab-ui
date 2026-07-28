import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SettingsIcon from "@mui/icons-material/Settings";
import { useTopoViewerStore } from "@srl-labs/clab-ui";

import { type AssistantCapabilities } from "../../api/client";
import { AssistantThread } from "./AssistantThread";
import { NetlabMascot } from "./NetlabMascot";
import {
  persistAssistantMode,
  persistAssistantModel,
  persistAssistantProvider,
  readAssistantMode,
  readAssistantModel,
  readAssistantProvider,
  type AssistantMode,
} from "./preferences";
import { useAssistantChat } from "./useAssistantChat";

export function AssistantPanel({
  capabilities,
  sessionId,
  onApplied,
  onPopOut,
  onClose,
  onOpenSettings,
  onCapabilitiesChanged,
}: {
  capabilities: AssistantCapabilities;
  sessionId: string;
  onApplied: () => void;
  onPopOut?: (() => void) | null;
  onClose?: () => void;
  onOpenSettings?: (providerId: string) => void;
  onCapabilitiesChanged?: () => void;
}) {
  const available = useMemo(
    () => (capabilities.providers ?? []).filter((provider) => provider.available),
    [capabilities.providers]
  );
  const unavailable = useMemo(
    () => (capabilities.providers ?? []).filter((provider) => !provider.available),
    [capabilities.providers]
  );

  const [providerId, setProviderId] = useState(() => readAssistantProvider());
  // Seed synchronously from the provider's last-used model so a configurable
  // provider is "ready" on mount instead of racing an async settings fetch.
  const [model, setModel] = useState(() => readAssistantModel(readAssistantProvider()));
  const [mode, setMode] = useState<AssistantMode>(() => readAssistantMode());

  useEffect(() => {
    if (!available.some((provider) => provider.id === providerId)) {
      setProviderId(available[0]?.id ?? "");
    }
  }, [available, providerId]);

  useEffect(() => {
    if (providerId) persistAssistantProvider(providerId);
    // Restore this provider's remembered model when switching providers.
    setModel(readAssistantModel(providerId));
  }, [providerId]);

  useEffect(() => {
    persistAssistantModel(providerId, model);
  }, [providerId, model]);

  useEffect(() => {
    persistAssistantMode(mode);
  }, [mode]);

  // A configurable provider needs a resolved model before it can send; the
  // others (Claude Code, Codex) ignore the model field entirely.
  const providerConfigurable = Boolean(
    (capabilities.providers ?? []).find((provider) => provider.id === providerId)?.configurable
  );
  const ready = Boolean(providerId) && (!providerConfigurable || Boolean(model));

  const selectedNode = useTopoViewerStore((state) => state.selectedNode);
  const selectedNodeName = selectedNode ? String(selectedNode) : null;
  const selection = useMemo(
    () => (selectedNodeName ? [selectedNodeName] : []),
    [selectedNodeName]
  );
  const { runtime, setProposalStatus, threadCount } = useAssistantChat(
    sessionId,
    providerId,
    mode,
    model,
    selection,
    ready
  );

  if (available.length === 0) {
    return (
      <Stack sx={{ height: "100%", minHeight: 0 }}>
        <Box sx={{ height: 2, flexShrink: 0, bgcolor: "warning.main" }} />
        <HeaderActions
          providerId={providerId}
          onOpenSettings={onOpenSettings}
          onPopOut={onPopOut}
          onClose={onClose}
        />
        <Stack spacing={2} sx={{ p: 2.5, overflow: "auto" }}>
          <Stack spacing={1} alignItems="center" sx={{ textAlign: "center", pt: 1 }}>
            <NetlabMascot size={48} state="offline" />
            <Typography variant="subtitle1" fontWeight={600}>
              No AI provider connected
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
              Sign in to a CLI agent or add an API key to start using the assistant.
            </Typography>
            {onOpenSettings && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => onOpenSettings(providerId)}
                sx={{ textTransform: "none", mt: 0.5 }}
              >
                Set up a provider
              </Button>
            )}
          </Stack>
          <Stack spacing={1}>
            {unavailable.map((provider) => (
              <Box
                key={provider.id}
                sx={{ border: 1, borderColor: "divider", borderRadius: 2, px: 1.5, py: 1 }}
              >
                <Typography variant="body2" fontWeight={600}>
                  {provider.name}
                </Typography>
                {provider.note && (
                  <Typography variant="caption" color="text.secondary">
                    {provider.note}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        </Stack>
      </Stack>
    );
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Stack sx={{ height: "100%", minHeight: 0, bgcolor: "background.default" }}>
        <Box sx={{ height: 2, flexShrink: 0, bgcolor: "warning.main" }} />

        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{ minHeight: 40, px: 0.75, borderBottom: 1, borderColor: "divider" }}
        >
          <Box sx={{ flex: 1 }} />
          <HeaderActions
            providerId={providerId}
            onOpenSettings={onOpenSettings}
            onPopOut={onPopOut}
            onClose={onClose}
          />
        </Stack>

        <AssistantThread
          selectedNode={selectedNodeName}
          providerPicker={{
            providers: available,
            providerId,
            onProviderChange: setProviderId,
            model,
            onModelChange: setModel,
            onCapabilitiesChanged,
          }}
          mode={mode}
          onModeChange={setMode}
          threadCount={threadCount}
          onProposalResolved={setProposalStatus}
          onApplied={onApplied}
        />
      </Stack>
    </AssistantRuntimeProvider>
  );
}


function HeaderActions({
  providerId,
  onOpenSettings,
  onPopOut,
  onClose,
}: {
  providerId: string;
  onOpenSettings?: (providerId: string) => void;
  onPopOut?: (() => void) | null;
  onClose?: () => void;
}) {
  return (
    <Stack direction="row" spacing={0.1} alignItems="center">
      {onOpenSettings && (
        <Tooltip title="Provider settings">
          <IconButton
            size="small"
            aria-label="Provider settings"
            onClick={() => onOpenSettings(providerId)}
          >
            <SettingsIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
      {onPopOut && (
        <Tooltip title="Open in a separate window">
          <IconButton size="small" aria-label="Open assistant in a separate window" onClick={onPopOut}>
            <OpenInNewIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
      {onClose && (
        <Tooltip title="Close">
          <IconButton size="small" aria-label="Close assistant" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}
