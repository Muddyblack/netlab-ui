import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  ButtonBase,
  CircularProgress,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import {
  api,
  type AssistantProvider,
  type AssistantProviderSettings,
} from "../../api/client";

export interface ProviderModelPickerProps {
  providers: AssistantProvider[];
  providerId: string;
  onProviderChange: (providerId: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  onCapabilitiesChanged?: () => void;
}

function ProviderMenu({ anchorEl, onClose, providers, providerId, onSelect }: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  providers: AssistantProvider[];
  providerId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose} slotProps={{ paper: { sx: { minWidth: 230, maxWidth: 320 } } }}>
      <Typography variant="overline" color="text.secondary" sx={{ px: 1.5 }}>
        Provider
      </Typography>
      {providers.map((candidate) => (
        <MenuItem key={candidate.id} selected={candidate.id === providerId} onClick={() => onSelect(candidate.id)}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            {candidate.id === providerId ? <CheckIcon sx={{ fontSize: 17 }} /> : null}
          </ListItemIcon>
          <ListItemText
            primary={candidate.name}
            secondary={candidate.version || undefined}
            slotProps={{ primary: { variant: "body2" }, secondary: { variant: "caption", noWrap: true } }}
          />
        </MenuItem>
      ))}
    </Menu>
  );
}

function ModelMenu({ anchorEl, onClose, modelDraft, setModelDraft, saveError, saving, models, model, onSubmit, onSelect }: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  modelDraft: string;
  setModelDraft: (value: string) => void;
  saveError: string | null;
  saving: boolean;
  models: string[];
  model: string;
  onSubmit: () => void;
  onSelect: (option: string) => void;
}) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: 310, maxWidth: "calc(100vw - 24px)", maxHeight: 420 } } }}
    >
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.75 }}
      >
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Type a model ID"
          value={modelDraft}
          onChange={(event) => setModelDraft(event.target.value)}
          error={Boolean(saveError)}
          slotProps={{ htmlInput: { "aria-label": "Model ID" } }}
        />
        <Tooltip title="Use model">
          <span>
            <IconButton type="submit" size="small" color="primary" disabled={!modelDraft.trim() || saving} aria-label="Use model">
              <ArrowForwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {saveError && (
        <Typography color="error" variant="caption" sx={{ display: "block", px: 1.5, pb: 0.75 }}>
          {saveError}
        </Typography>
      )}
      {models.length > 0 && <Divider />}
      {models.map((option) => (
        <MenuItem key={option} selected={option === model} onClick={() => onSelect(option)} sx={{ minHeight: 36 }}>
          <ListItemIcon sx={{ minWidth: 30 }}>
            {option === model ? <CheckIcon sx={{ fontSize: 17 }} /> : null}
          </ListItemIcon>
          <ListItemText primary={option} slotProps={{ primary: { variant: "body2", noWrap: true, title: option } }} />
        </MenuItem>
      ))}
    </Menu>
  );
}

export interface ProviderModelPickerHandle {
  openProvider: () => void;
  openModel: () => void;
}

export const ProviderModelPicker = forwardRef<
  ProviderModelPickerHandle,
  ProviderModelPickerProps
>(function ProviderModelPicker(
  {
    providers,
    providerId,
    onProviderChange,
    model,
    onModelChange,
    onCapabilitiesChanged,
  },
  ref
) {
  const takesModel = Boolean(providers.find((p) => p.id === providerId)?.takesModel);
  const [settings, setSettings] = useState<AssistantProviderSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelDraft, setModelDraft] = useState(model);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [providerAnchor, setProviderAnchor] = useState<HTMLElement | null>(null);
  const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
  const providerButton = useRef<HTMLButtonElement | null>(null);
  const modelButton = useRef<HTMLButtonElement | null>(null);
  const requestId = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    setModelDraft(model);
  }, [model]);

  useEffect(() => {
    if (!takesModel) {
      setSettings(null);
      setModels([]);
      setModelDraft("");
      onModelChange("");
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setSaveError(null);
    void Promise.all([
      api.getAssistantProviderSettings(providerId),
      api.getAssistantProviderModels(providerId).catch(() => ({ models: [] })),
    ])
      .then(([nextSettings, nextModels]) => {
        if (requestId.current !== currentRequest) return;
        setSettings(nextSettings);
        setModels(nextModels.models ?? []);
        setModelDraft(nextSettings.model ?? "");
        onModelChange(nextSettings.model ?? "");
      })
      .catch((err) => {
        if (requestId.current !== currentRequest) return;
        setSaveError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoading(false);
      });
  }, [takesModel, onModelChange, providerId]);

  const saveModel = useCallback(
    async (nextModel: string) => {
      const trimmed = nextModel.trim();
      if (!takesModel || !trimmed || trimmed === model || savingRef.current) {
        setModelDraft(trimmed || model);
        setModelAnchor(null);
        return;
      }

      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        const updated = await api.putAssistantProviderSettings(providerId, {
          model: trimmed,
        });
        const savedModel = updated.model || trimmed;
        setSettings(updated);
        setModelDraft(savedModel);
        onModelChange(savedModel);
        onCapabilitiesChanged?.();
        setModelAnchor(null);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
        setModelDraft(model);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [takesModel, model, onCapabilitiesChanged, onModelChange, providerId]
  );

  const provider = useMemo(
    () => providers.find((candidate) => candidate.id === providerId),
    [providerId, providers]
  );
  const modelLocked = settings?.envLocked?.includes("model") ?? false;

  useImperativeHandle(
    ref,
    () => ({
      openProvider: () => setProviderAnchor(providerButton.current),
      openModel: () => {
        if (takesModel) setModelAnchor(modelButton.current);
      },
    }),
    [takesModel]
  );

  return (
    <>
      <Stack direction="row" spacing={0.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <SelectorButton
          buttonRef={providerButton}
          label={provider?.name ?? "Provider"}
          secondary={!takesModel ? provider?.version : undefined}
          ariaLabel="Select AI provider"
          onClick={(event) => setProviderAnchor(event.currentTarget)}
        />
        {takesModel && (
          <>
            <Typography variant="caption" color="text.disabled" aria-hidden>
              /
            </Typography>
            <SelectorButton
              buttonRef={modelButton}
              label={model || (loading ? "Loading models" : "Select model")}
              ariaLabel="Select AI model"
              loading={loading || saving}
              error={saveError}
              disabled={modelLocked}
              onClick={(event) => setModelAnchor(event.currentTarget)}
            />
          </>
        )}
      </Stack>

      <ProviderMenu
        anchorEl={providerAnchor}
        onClose={() => setProviderAnchor(null)}
        providers={providers}
        providerId={providerId}
        onSelect={(id) => {
          onProviderChange(id);
          setProviderAnchor(null);
        }}
      />

      <ModelMenu
        anchorEl={modelAnchor}
        onClose={() => {
          setModelDraft(model);
          setModelAnchor(null);
        }}
        modelDraft={modelDraft}
        setModelDraft={setModelDraft}
        saveError={saveError}
        saving={saving}
        models={models}
        model={model}
        onSubmit={() => void saveModel(modelDraft)}
        onSelect={(option) => void saveModel(option)}
      />
    </>
  );
});

function SelectorButton({
  buttonRef,
  label,
  secondary,
  ariaLabel,
  loading = false,
  error,
  disabled = false,
  onClick,
}: {
  buttonRef: React.Ref<HTMLButtonElement>;
  label: string;
  secondary?: string | null;
  ariaLabel: string;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <ButtonBase
      ref={buttonRef}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      sx={{
        minWidth: 0,
        maxWidth: secondary ? 190 : 220,
        height: 30,
        borderRadius: 1,
        px: 0.75,
        color: error ? "error.main" : "text.primary",
        "&:hover": { bgcolor: "action.hover" },
        "&.Mui-disabled": { color: "text.disabled" },
      }}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        {loading ? <CircularProgress size={12} color="inherit" /> : null}
        {error ? <ErrorOutlineIcon sx={{ fontSize: 14 }} /> : null}
        <Box sx={{ minWidth: 0, textAlign: "left" }}>
          <Typography variant="body2" noWrap sx={{ fontSize: "0.8125rem", lineHeight: 1.15 }}>
            {label}
          </Typography>
          {secondary && (
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              sx={{ display: "block", fontSize: "0.625rem", lineHeight: 1 }}
            >
              {secondary}
            </Typography>
          )}
        </Box>
        <ExpandMoreIcon sx={{ flexShrink: 0, fontSize: 16, color: "text.secondary" }} />
      </Stack>
    </ButtonBase>
  );
}
