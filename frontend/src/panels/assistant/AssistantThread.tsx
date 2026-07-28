import { useMemo, useRef, useState, type ComponentType, type MouseEvent } from "react";
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  unstable_useSlashCommandAdapter,
  unstable_useTriggerPopoverScopeContextOptional,
  useAui,
  type DataMessagePartProps,
  type EmptyMessagePartProps,
  type TextMessagePartProps,
  type ToolCallMessagePartProps,
  type Unstable_TriggerItem,
} from "@assistant-ui/react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Collapse,
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
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BuildIcon from "@mui/icons-material/Build";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DnsIcon from "@mui/icons-material/Dns";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import NoteAddOutlinedIcon from "@mui/icons-material/NoteAddOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import StopIcon from "@mui/icons-material/Stop";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { AssistantProposal } from "../../api/client";
import { NetlabMascot } from "./NetlabMascot";
import { ProposalCard } from "./ProposalCard";
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

interface Props {
  selectedNode: string | null;
  providerPicker: ProviderModelPickerProps;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  threadCount: number;
  onProposalResolved: (proposalId: string, status: AssistantProposal["status"]) => void;
  onApplied: () => void;
}

export function AssistantThread({
  selectedNode,
  providerPicker,
  mode,
  onModeChange,
  threadCount,
  onProposalResolved,
  onApplied,
}: Props) {
  const ProposalPart = useMemo<ComponentType<DataMessagePartProps<AssistantProposal>>>(
    () =>
      function ProposalMessagePart({ data }) {
        return (
          <ProposalCard
            proposal={data}
            onResolved={(status) => onProposalResolved(data.id, status)}
            onApplied={onApplied}
          />
        );
      },
    [onApplied, onProposalResolved]
  );

  const messageComponents = useMemo(
    () => ({
      Text: MarkdownText,
      Empty: AssistantThinking,
      tools: { Fallback: ToolCall },
      data: {
        by_name: {
          proposal: ProposalPart,
          error: AssistantError,
        },
      },
    }),
    [ProposalPart]
  );

  return (
    <ThreadPrimitive.Root
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        flexDirection: "column",
        position: "relative",
      }}
    >
      <ThreadPrimitive.Viewport
        autoScroll
        turnAnchor="bottom"
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          flexDirection: "column",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <Welcome />
        </AuiIf>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 1.5 }}>
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? (
                <UserMessage components={messageComponents} />
              ) : (
                <AssistantMessage components={messageComponents} />
              )
            }
          </ThreadPrimitive.Messages>
        </Box>

        <Box sx={{ position: "sticky", bottom: 86, zIndex: 1, height: 0 }}>
          <ThreadPrimitive.ScrollToBottom asChild>
            <IconButton
              size="small"
              aria-label="Scroll to latest message"
              sx={{
                position: "absolute",
                right: 12,
                bottom: 8,
                width: 30,
                height: 30,
                border: 1,
                borderColor: "divider",
                bgcolor: "background.paper",
                boxShadow: 2,
                transition: "opacity 120ms ease",
                "&:hover": { bgcolor: "action.hover" },
                "&:disabled": { opacity: 0, pointerEvents: "none" },
              }}
            >
              <KeyboardArrowDownIcon fontSize="small" />
            </IconButton>
          </ThreadPrimitive.ScrollToBottom>
        </Box>

        <ThreadPrimitive.ViewportFooter
          style={{
            position: "sticky",
            bottom: 0,
            marginTop: "auto",
            zIndex: 2,
          }}
        >
          <Composer
            selectedNode={selectedNode}
            providerPicker={providerPicker}
            mode={mode}
            onModeChange={onModeChange}
            threadCount={threadCount}
          />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function Welcome() {
  return (
    <Stack spacing={1} alignItems="center" sx={{ px: 2.5, pt: 5, pb: 2, textAlign: "center" }}>
      <NetlabMascot size={110} />
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 0.5 }}>
        How can I help with this lab?
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
        Ask about the topology, inspect the running lab, or have me propose changes for you to approve.
      </Typography>

      <Stack spacing={0.75} sx={{ width: "100%", maxWidth: 340, mt: 1.5 }}>
        <ThreadPrimitive.Suggestions>
          {() => (
            <SuggestionPrimitive.Trigger asChild send={false}>
              <Button
                variant="outlined"
                color="inherit"
                fullWidth
                endIcon={<ArrowForwardIcon sx={{ fontSize: 15, color: "text.secondary" }} />}
                sx={{
                  justifyContent: "space-between",
                  textAlign: "left",
                  textTransform: "none",
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  borderColor: "divider",
                  color: "text.primary",
                  fontWeight: 400,
                  fontSize: "0.8125rem",
                  lineHeight: 1.35,
                  "&:hover": { borderColor: "text.secondary", bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <SuggestionPrimitive.Title />
                </Box>
              </Button>
            </SuggestionPrimitive.Trigger>
          )}
        </ThreadPrimitive.Suggestions>
      </Stack>
    </Stack>
  );
}

function UserMessage({
  components,
}: {
  components: NonNullable<Parameters<typeof MessagePrimitive.Parts>[0]["components"]>;
}) {
  return (
    <MessagePrimitive.Root
      style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
    >
      <Box
        sx={{
          maxWidth: "88%",
          borderRadius: 1,
          bgcolor: "action.selected",
          px: 1.25,
          py: 0.8,
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
          fontSize: "0.875rem",
        }}
      >
        <MessagePrimitive.Parts components={components} />
      </Box>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage({
  components,
}: {
  components: NonNullable<Parameters<typeof MessagePrimitive.Parts>[0]["components"]>;
}) {
  return (
    <MessagePrimitive.Root style={{ minWidth: 0 }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack spacing={1}>
          <MessagePrimitive.Parts components={components} />
        </Stack>
        <ActionBarPrimitive.Root hideWhenRunning autohide="not-last">
          <AuiIf condition={(state) => state.message.parts.some((part) => part.type === "text")}>
            <Tooltip title="Copy response">
              <ActionBarPrimitive.Copy asChild>
                <IconButton
                  size="small"
                  aria-label="Copy response"
                  sx={{ mt: 0.25, ml: -0.5, width: 26, height: 26, color: "text.secondary" }}
                >
                  <AuiIf condition={(state) => state.message.isCopied}>
                    <CheckIcon color="success" sx={{ fontSize: 14 }} />
                  </AuiIf>
                  <AuiIf condition={(state) => !state.message.isCopied}>
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </AuiIf>
                </IconButton>
              </ActionBarPrimitive.Copy>
            </Tooltip>
          </AuiIf>
        </ActionBarPrimitive.Root>
      </Box>
    </MessagePrimitive.Root>
  );
}

function MarkdownText({ text }: TextMessagePartProps) {
  return (
    <Box
      sx={{
        minWidth: 0,
        overflowWrap: "anywhere",
        fontSize: "0.875rem",
        lineHeight: 1.55,
        "& p": { mt: 0, mb: 1 },
        "& p:last-child": { mb: 0 },
        "& ul, & ol": { mt: 0.5, mb: 1, pl: 2.5 },
        "& li": { mb: 0.35 },
        "& h1, & h2, & h3, & h4": {
          mt: 1.5,
          mb: 0.75,
          fontSize: "0.9375rem",
          lineHeight: 1.35,
        },
        "& h1:first-of-type, & h2:first-of-type, & h3:first-of-type": { mt: 0 },
        "& pre": {
          m: "8px 0",
          p: 1,
          maxWidth: "100%",
          overflowX: "auto",
          borderRadius: 1,
          bgcolor: "action.hover",
          border: 1,
          borderColor: "divider",
          fontSize: "0.75rem",
        },
        "& code": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "0.82em",
        },
        "& :not(pre) > code": {
          px: 0.4,
          py: 0.1,
          borderRadius: 0.5,
          bgcolor: "action.hover",
        },
        "& table": { display: "block", maxWidth: "100%", overflowX: "auto", borderCollapse: "collapse" },
        "& th, & td": { border: 1, borderColor: "divider", px: 0.75, py: 0.5 },
        "& a": { color: "primary.main" },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </Box>
  );
}

function AssistantThinking(_props: EmptyMessagePartProps) {
  // The Empty part renders whenever a message has no *standard* parts — which
  // includes a turn that produced only a data part (an error or a proposal).
  // Gate on running status so a finished-with-error turn doesn't sit here
  // "Thinking…" forever below its error box.
  return (
    <AuiIf condition={(state) => state.message.status?.type === "running"}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minHeight: 24 }}>
        <NetlabMascot size={20} state="thinking" showCaption={false} />
        <Typography variant="caption" color="text.secondary">
          Thinking…
        </Typography>
      </Stack>
    </AuiIf>
  );
}

function ToolCall({
  toolName,
  args,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const [open, setOpen] = useState(false);
  const running = status.type === "running" && result === undefined;
  const label = toolName.replaceAll("_", " ");
  const statusLabel = toolStatusLabel(label, running, Boolean(isError));

  return (
    <Box
      sx={{
        borderLeft: 2,
        borderColor: isError ? "error.main" : "divider",
        pl: 1,
      }}
    >
      <ButtonBase
        onClick={() => setOpen((value) => !value)}
        sx={{
          width: "100%",
          minHeight: 28,
          justifyContent: "flex-start",
          borderRadius: 1,
          px: 0.5,
          color: "text.secondary",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
          {running ? (
            <CircularProgress size={12} />
          ) : (
            <BuildIcon color={isError ? "error" : "inherit"} sx={{ fontSize: 14 }} />
          )}
          <Typography
            variant="caption"
            sx={{ minWidth: 0, flex: 1, textAlign: "left", fontFamily: "monospace" }}
            noWrap
          >
            {statusLabel}
          </Typography>
          <ExpandMoreIcon
            sx={{
              fontSize: 16,
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 120ms ease",
            }}
          />
        </Stack>
      </ButtonBase>
      <Collapse in={open}>
        <Box
          component="pre"
          sx={{
            m: 0.5,
            p: 1,
            maxHeight: "24vh",
            overflow: "auto",
            borderRadius: 1,
            bgcolor: "action.hover",
            color: "text.secondary",
            fontSize: "0.7rem",
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {JSON.stringify(args ?? {}, null, 2)}
          {result !== undefined ? `\n\n${formatToolResult(result)}` : ""}
        </Box>
      </Collapse>
    </Box>
  );
}

function toolStatusLabel(label: string, running: boolean, isError: boolean): string {
  if (running) return `Running ${label}`;
  if (isError) return `${label} failed`;
  return `Used ${label}`;
}

function formatToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function AssistantError({ data }: DataMessagePartProps<{ message: string }>) {
  return (
    <Alert severity="error" sx={{ py: 0.25, "& .MuiAlert-message": { fontSize: "0.8125rem" } }}>
      {data.message}
    </Alert>
  );
}

function Composer({
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

const SLASH_ICONS: Record<string, typeof NoteAddOutlinedIcon> = {
  new: NoteAddOutlinedIcon,
  history: HistoryIcon,
  model: SmartToyIcon,
  provider: DnsIcon,
};

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
