import { useRef, useState, type MouseEvent } from "react";
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Tooltip,
  Typography,
  styled,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DnsIcon from "@mui/icons-material/Dns";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import StopIcon from "@mui/icons-material/Stop";
import {
  AuiIf,
  ComposerPrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  unstable_useSlashCommandAdapter,
  unstable_useTriggerPopoverScopeContextOptional,
  useAui,
  type Unstable_TriggerItem,
} from "@assistant-ui/react";

import {
  ProviderModelPicker,
  type ProviderModelPickerHandle,
  type ProviderModelPickerProps,
} from "./ProviderModelPicker";
import { MODES, type AssistantMode } from "./preferences";

const ComposerInput = styled(ComposerPrimitive.Input)(({ theme }) => ({
  width: "100%",
  minHeight: 42,
  maxHeight: 144,
  resize: "none",
  border: 0,
  outline: 0,
  padding: "11px 12px 6px",
  background: "transparent",
  color: theme.palette.text.primary,
  font: "inherit",
  fontSize: "0.875rem",
  lineHeight: 1.45,
  "&::placeholder": {
    color: theme.palette.text.secondary,
    opacity: 0.9,
  },
}));

const SLASH_ICONS: Record<string, typeof NoteAddOutlinedIcon> = {
  new: NoteAddOutlinedIcon,
  history: HistoryIcon,
  model: SmartToyIcon,
  provider: DnsIcon,
};

export function Composer({
  selectedNode,
  providerPicker,
  mode,
  onModeChange,
  threadCount,
}: {
  selectedNode: string | null;
  providerPicker: ProviderModelPickerProps;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  threadCount: number;
}) {
  const aui = useAui();
  const picker = useRef<ProviderModelPickerHandle>(null);
  const historyButton = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modeAnchor, setModeAnchor] = useState<HTMLElement | null>(null);
  const currentMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const slash = unstable_useSlashCommandAdapter({
    removeOnExecute: true,
    commands: [
      {
        id: "new",
        label: "New conversation",
        description: "Start a clean thread",
        icon: "new",
        execute: () => aui.threads().switchToNewThread(),
      },
      {
        id: "history",
        label: "Conversation history",
        description: "Open previous conversations",
        icon: "history",
        execute: () => setHistoryOpen(true),
      },
      {
        id: "model",
        label: "Change model",
        description: "Choose the model used for new messages",
        icon: "model",
        execute: () => picker.current?.openModel(),
      },
      {
        id: "provider",
        label: "Change provider",
        description: "Choose Gemini, Claude, Codex, or another provider",
        icon: "provider",
        execute: () => picker.current?.openProvider(),
      },
    ],
  });

  const handleSlashClick = () => {
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.focus();
    // Insert "/" at the caret instead of replacing the composer's text. The native
    // setter + dispatchEvent (rather than textarea.value = ...) is required so React's
    // controlled-input onChange fires and picks up the trigger character.
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const nextValue = `${textarea.value.slice(0, start)}/${textarea.value.slice(end)}`;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    nativeInputValueSetter?.call(textarea, nextValue);
    const caret = start + 1;
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };

  return (
    <Box
      sx={{
        px: 1.25,
        pt: 1,
        pb: 1.25,
        bgcolor: "background.default",
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Unstable_TriggerPopover char="/" adapter={slash.adapter}>
          <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
          <SlashCommandPopoverContent />
        </ComposerPrimitive.Unstable_TriggerPopover>

        <ComposerPrimitive.Root
          style={{ display: "flex", flexDirection: "column" }}
          aria-label="Assistant message composer"
        >
          <Box
            sx={{
              border: "1.5px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "background.paper",
              transition: "border-color 120ms ease",
              "&:focus-within": { borderColor: "warning.main" },
            }}
          >
            <ComposerInput
              ref={composerInputRef}
              rows={1}
              placeholder={selectedNode ? `Ask about ${selectedNode}` : "Ask about this lab"}
              submitOnEnter
              autoFocus={false}
            />
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.25}
              sx={{ minHeight: 40, px: 0.75, pb: 0.5 }}
            >
              {/* Agent mode pill */}
              <Tooltip title={currentMode.description}>
                <ButtonBase
                  aria-label="Select agent mode"
                  onClick={(event: MouseEvent<HTMLElement>) => setModeAnchor(event.currentTarget)}
                  sx={{
                    minHeight: 26,
                    borderRadius: 1,
                    px: 0.75,
                    gap: 0.25,
                    border: "1px solid",
                    borderColor: "divider",
                    color: "text.secondary",
                    fontSize: "0.75rem",
                    transition: "all 120ms ease",
                    "&:hover": {
                      bgcolor: "action.hover",
                      color: "text.primary",
                      borderColor: "text.disabled",
                    },
                  }}
                >
                  <Typography variant="caption" color="inherit" sx={{ fontWeight: 500, lineHeight: 1 }}>
                    {currentMode.label}
                  </Typography>
                  <ExpandMoreIcon sx={{ fontSize: 14, ml: -0.25 }} />
                </ButtonBase>
              </Tooltip>

              {/* Slash-command trigger */}
              <Tooltip title="Commands (type / in the input)">
                <IconButton
                  size="small"
                  aria-label="Show slash commands"
                  onClick={handleSlashClick}
                  sx={{
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: 1,
                    border: "1px solid",
                    borderColor: "divider",
                    color: "text.secondary",
                    fontSize: "0.8125rem",
                    fontWeight: 700,
                    fontFamily: "monospace",
                    transition: "all 120ms ease",
                    "&:hover": {
                      bgcolor: "action.hover",
                      color: "text.primary",
                      borderColor: "text.disabled",
                    },
                  }}
                >
                  /
                </IconButton>
              </Tooltip>

              <Tooltip title="Conversation history">
                <IconButton
                  ref={historyButton}
                  size="small"
                  aria-label="Conversation history"
                  onClick={() => setHistoryOpen(true)}
                  sx={{ width: 30, height: 30, flexShrink: 0, color: "text.secondary" }}
                >
                  <HistoryIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <ProviderModelPicker ref={picker} {...providerPicker} />
              <Box sx={{ flex: 1, minWidth: 4 }} />
              {selectedNode ? (
                <Tooltip title={`Canvas context: ${selectedNode}`}>
                  <Chip
                    size="small"
                    label={selectedNode}
                    sx={{
                      display: { xs: "none", sm: "flex" },
                      maxWidth: 92,
                      height: 22,
                      mr: 0.25,
                      borderRadius: 1,
                      "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
                    }}
                  />
                </Tooltip>
              ) : null}
              <AuiIf condition={(state) => !state.thread.isRunning}>
                <Tooltip title="Send">
                  <ComposerPrimitive.Send asChild>
                    <IconButton
                      aria-label="Send message"
                      sx={{
                        width: 30,
                        height: 30,
                        flexShrink: 0,
                        borderRadius: 1.5,
                        color: "warning.contrastText",
                        bgcolor: "warning.main",
                        "&:hover": { bgcolor: "warning.dark" },
                        "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" },
                      }}
                    >
                      <ArrowUpwardIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </ComposerPrimitive.Send>
                </Tooltip>
              </AuiIf>
              <AuiIf condition={(state) => state.thread.isRunning}>
                <Tooltip title="Stop">
                  <ComposerPrimitive.Cancel asChild>
                    <IconButton
                      aria-label="Stop response"
                      sx={{
                        width: 30,
                        height: 30,
                        flexShrink: 0,
                        borderRadius: 1.5,
                        color: "error.contrastText",
                        bgcolor: "error.main",
                        "&:hover": { bgcolor: "error.dark" },
                      }}
                    >
                      <StopIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </ComposerPrimitive.Cancel>
                </Tooltip>
              </AuiIf>
            </Stack>
          </Box>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>

      {/* Mode picker menu */}
      <Menu
        anchorEl={modeAnchor}
        open={Boolean(modeAnchor)}
        onClose={() => setModeAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              width: 280,
              maxWidth: "calc(100vw - 20px)",
              borderRadius: 2,
              backdropFilter: "blur(12px)",
            },
          },
        }}
      >
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            display: "block",
            px: 1.5,
            pt: 0.5,
            pb: 0.25,
            fontSize: "0.625rem",
            letterSpacing: "0.1em",
          }}
        >
          Agent mode
        </Typography>
        {MODES.map((candidate) => (
          <MenuItem
            key={candidate.id}
            selected={candidate.id === mode}
            onClick={() => {
              onModeChange(candidate.id);
              setModeAnchor(null);
            }}
            sx={{
              borderRadius: 1,
              mx: 0.5,
              "&.Mui-selected": {
                bgcolor: "action.selected",
                "&:hover": { bgcolor: "action.selected" },
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              {candidate.id === mode ? (
                <CheckIcon sx={{ fontSize: 16, color: "warning.main" }} />
              ) : null}
            </ListItemIcon>
            <ListItemText
              primary={candidate.label}
              secondary={candidate.description}
              slotProps={{
                primary: { variant: "body2", sx: { fontWeight: candidate.id === mode ? 600 : 400 } },
                secondary: { variant: "caption" },
              }}
            />
          </MenuItem>
        ))}
      </Menu>

      <ConversationHistory
        open={historyOpen}
        anchorEl={historyButton.current}
        threadCount={threadCount}
        onClose={() => setHistoryOpen(false)}
      />
    </Box>
  );
}

function SlashCommandPopoverContent() {
  const ctx = unstable_useTriggerPopoverScopeContextOptional();
  if (!ctx?.open) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        zIndex: 5,
        left: 6,
        right: 6,
        bottom: "calc(100% - 10px)",
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        backdropFilter: "blur(12px)",
        boxShadow: 8,
      }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{
          display: "block",
          px: 1.5,
          pt: 1,
          pb: 0.5,
          fontSize: "0.625rem",
          letterSpacing: "0.1em",
        }}
      >
        Commands
      </Typography>
      <ComposerPrimitive.Unstable_TriggerPopoverItems>
        {(items) =>
          items.map((item, index) => (
            <SlashCommandItem key={item.id} item={item} index={index} />
          ))
        }
      </ComposerPrimitive.Unstable_TriggerPopoverItems>
    </Box>
  );
}

function SlashCommandItem({ item, index }: { item: Unstable_TriggerItem; index: number }) {
  const Icon = SLASH_ICONS[(item as { icon?: string }).icon ?? ""] ?? null;
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItem
      item={item}
      index={index}
      style={{
        display: "flex",
        width: "100%",
        minHeight: 42,
        alignItems: "center",
        gap: 10,
        border: 0,
        padding: "6px 12px",
        margin: "0 4px",
        borderRadius: 6,
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
        transition: "background 80ms ease",
      }}
    >
      {Icon && (
        <Icon
          sx={{
            fontSize: 16,
            color: "text.disabled",
            flexShrink: 0,
          }}
        />
      )}
      <Typography
        variant="body2"
        sx={{
          width: 72,
          flexShrink: 0,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontWeight: 600,
          fontSize: "0.8125rem",
          color: "warning.main",
        }}
      >
        /{item.id}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
        {item.description}
      </Typography>
    </ComposerPrimitive.Unstable_TriggerPopoverItem>
  );
}

function ConversationHistory({
  open,
  anchorEl,
  threadCount,
  onClose,
}: {
  open: boolean;
  anchorEl: HTMLElement | null;
  threadCount: number;
  onClose: () => void;
}) {
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      transformOrigin={{ vertical: "bottom", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            width: 310,
            maxWidth: "calc(100vw - 20px)",
            maxHeight: 420,
            borderRadius: 1,
          },
        },
      }}
    >
      <ThreadListPrimitive.Root>
        <Stack direction="row" alignItems="center" sx={{ minHeight: 42, px: 1.25 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Conversations
          </Typography>
          <ThreadListPrimitive.New asChild>
            <Button size="small" startIcon={<NoteAddOutlinedIcon sx={{ fontSize: 16 }} />}>
              New
            </Button>
          </ThreadListPrimitive.New>
        </Stack>
        <Divider />
        {threadCount === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No conversations yet.
          </Typography>
        ) : (
          <Box sx={{ p: 0.5 }}>
            <ThreadListPrimitive.Items
              components={{
                ThreadListItem: HistoryItem,
              }}
            />
          </Box>
        )}
      </ThreadListPrimitive.Root>
    </Popover>
  );
}

function HistoryItem() {
  return (
    <ThreadListItemPrimitive.Root
      style={{ display: "flex", width: "100%", alignItems: "center" }}
    >
      <ThreadListItemPrimitive.Trigger asChild>
        <ButtonBase
          sx={{
            minWidth: 0,
            flex: 1,
            justifyContent: "flex-start",
            borderRadius: 1,
            px: 1,
            py: 0.8,
            textAlign: "left",
            "&[data-active]": { bgcolor: "action.selected" },
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Typography variant="body2" noWrap>
            <ThreadListItemPrimitive.Title fallback="New conversation" />
          </Typography>
        </ButtonBase>
      </ThreadListItemPrimitive.Trigger>
      <Tooltip title="Delete conversation">
        <ThreadListItemPrimitive.Delete asChild>
          <IconButton size="small" aria-label="Delete conversation" sx={{ width: 28, height: 28 }}>
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </ThreadListItemPrimitive.Delete>
      </Tooltip>
    </ThreadListItemPrimitive.Root>
  );
}
