import { useMemo, type ComponentType } from "react";
import { AuiIf, ThreadPrimitive, type DataMessagePartProps } from "@assistant-ui/react";
import { Box, IconButton } from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";

import type { AssistantProposal } from "../../api/client";
import { ProposalCard } from "./ProposalCard";
import type { ProviderModelPickerProps } from "./ProviderModelPicker";
import type { AssistantMode } from "./preferences";
import { AssistantWelcome } from "./AssistantWelcome";
import { MarkdownText } from "./MarkdownMessagePart";
import { AssistantThinking } from "./AssistantThinkingPart";
import { ToolCall } from "./ToolCallPart";
import { AssistantError } from "./AssistantErrorPart";
import { UserMessage, AssistantMessage } from "./MessageParts";
import { Composer } from "./AssistantComposer";

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
          <AssistantWelcome />
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
