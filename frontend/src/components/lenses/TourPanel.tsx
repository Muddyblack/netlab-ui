import AddAPhotoOutlinedIcon from "@mui/icons-material/AddAPhotoOutlined";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import SaveIcon from "@mui/icons-material/Save";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useState, type Dispatch, type SetStateAction } from "react";

import { api, type TeachingDocument, type TeachingStep, type TourView } from "../../api/client";

interface TourPanelProps {
  sessionId: string;
  document: TeachingDocument | null;
  setDocument: Dispatch<SetStateAction<TeachingDocument | null>>;
  currentIndex: number;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<"author" | "present">>;
  // Snapshot the live canvas / restore a captured view — both owned by the hook
  // so authoring reuses the exact same reveal machinery playback does.
  captureView: () => TourView;
  applyView: (view: TourView) => void;
  onClose: () => void;
  onToast: (message: string, severity?: "success" | "info" | "warning" | "error") => void;
}

function makeStep(view: TourView, index: number): TeachingStep {
  return {
    id: `step-${Date.now().toString(36)}-${index + 1}`,
    caption: "",
    note: "",
    view,
  };
}

function revealSummary(view: TourView): string {
  if (!view.revealRefs.length) return "whole topology";
  if (view.revealRefs.length === 1) return view.revealRefs[0].replace(/^[a-z]+:/, "");
  return `${view.revealRefs.length} objects`;
}

export function TourPanel({
  sessionId,
  document,
  setDocument,
  currentIndex,
  setCurrentIndex,
  setMode,
  captureView,
  applyView,
  onClose,
  onToast,
}: TourPanelProps) {
  const [saving, setSaving] = useState(false);
  const steps = document?.steps ?? [];

  const update = (fn: (value: TeachingDocument) => TeachingDocument) =>
    setDocument((value) => (value ? fn(value) : value));

  const updateCurrentStep = (fn: (step: TeachingStep) => TeachingStep) =>
    update((value) => ({
      ...value,
      steps: value.steps.map((step, index) => (index === currentIndex ? fn(step) : step)),
    }));

  const captureStep = () => {
    const view = captureView();
    update((value) => ({ ...value, steps: [...value.steps, makeStep(view, value.steps.length)] }));
    setCurrentIndex(steps.length);
  };

  const recaptureStep = () => {
    const view = captureView();
    updateCurrentStep((step) => ({ ...step, view }));
    onToast("Step updated to the current view", "success");
  };

  const removeStep = (index: number) => {
    update((value) => ({ ...value, steps: value.steps.filter((_step, i) => i !== index) }));
    setCurrentIndex((i) => Math.max(0, i > index ? i - 1 : i));
  };

  const moveStep = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    update((value) => {
      const next = [...value.steps];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...value, steps: next };
    });
    setCurrentIndex(target);
  };

  const selectStep = (index: number) => {
    setCurrentIndex(index);
    const step = steps[index];
    if (step) applyView(step.view);
  };

  const save = async () => {
    if (!document) return;
    setSaving(true);
    try {
      const response = await api.saveTeaching(sessionId, document);
      setDocument(response.document);
      onToast("Tour saved alongside the topology", "success");
    } catch (error) {
      onToast(`Could not save tour: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const present = () => {
    setCurrentIndex(0);
    setMode("present");
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5, py: 0.5 }}>
        <PlayArrowIcon color="warning" fontSize="small" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>Tour</Typography>
          <Typography variant="caption" color="text.secondary">Arrange the canvas, capture it, then present</Typography>
        </Box>
        <Tooltip title="Save alongside the topology">
          <span><IconButton size="small" disabled={!document || saving} onClick={() => void save()}><SaveIcon fontSize="small" /></IconButton></span>
        </Tooltip>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Stack>
      <Divider />

      {!document ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>Loading tour…</Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, px: 1.5, pt: 1 }}>
          <TextField
            fullWidth
            size="small"
            label="Tour title"
            value={document.title}
            onChange={(event) => update((value) => ({ ...value, title: event.target.value }))}
            sx={{ mb: 1 }}
          />
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button fullWidth size="small" variant="contained" startIcon={<AddAPhotoOutlinedIcon />} onClick={captureStep}>
              Capture step
            </Button>
            <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} disabled={!steps.length} onClick={present}>
              Present
            </Button>
          </Stack>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", mx: -0.5, px: 0.5 }}>
            {!steps.length && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                No steps yet. Set up the canvas with any lens, spotlight what you want (select a node, follow a service,
                trace a path), then hit <strong>Capture step</strong>.
              </Typography>
            )}

            <Stack spacing={0.75}>
              {steps.map((step, index) => {
                const active = index === currentIndex;
                return (
                  <Box
                    key={step.id}
                    onClick={() => selectStep(index)}
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      border: "1px solid",
                      borderColor: active ? "primary.main" : "divider",
                      bgcolor: active ? "action.selected" : "transparent",
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip size="small" label={index + 1} sx={{ height: 20, minWidth: 24 }} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {step.caption || "Untitled step"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {step.view.lens} · {revealSummary(step.view)}
                        </Typography>
                      </Box>
                    </Stack>
                    {active && (
                      <>
                        <TextField
                          fullWidth
                          size="small"
                          label="Caption"
                          value={step.caption}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateCurrentStep((s) => ({ ...s, caption: event.target.value }))}
                          sx={{ mt: 1 }}
                        />
                        <TextField
                          fullWidth
                          size="small"
                          multiline
                          minRows={2}
                          label="Speaker note (optional)"
                          value={step.note}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => updateCurrentStep((s) => ({ ...s, note: event.target.value }))}
                          sx={{ mt: 1 }}
                        />
                        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                          <Tooltip title="Re-snapshot this step from the current canvas">
                            <Button size="small" startIcon={<ReplayIcon fontSize="small" />} onClick={(event) => { event.stopPropagation(); recaptureStep(); }}>
                              Recapture
                            </Button>
                          </Tooltip>
                          <Stack direction="row">
                            <Tooltip title="Move up"><span><IconButton size="small" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveStep(index, -1); }}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                            <Tooltip title="Move down"><span><IconButton size="small" disabled={index === steps.length - 1} onClick={(event) => { event.stopPropagation(); moveStep(index, 1); }}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                            <Tooltip title="Delete step"><IconButton size="small" color="error" onClick={(event) => { event.stopPropagation(); removeStep(index); }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                          </Stack>
                        </Stack>
                      </>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </Box>
      )}
    </Box>
  );
}
