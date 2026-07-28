import type { AssistantProposal } from "../../api/client";

export type ChatMessageStatus =
  | { type: "running" }
  | { type: "complete"; reason: "stop" | "unknown" }
  | {
      type: "incomplete";
      reason: "cancelled" | "length" | "content-filter" | "other" | "error";
      error?: string;
    };

export type ChatMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      toolName: string;
      args: unknown;
      result?: string;
      isError?: boolean;
    }
  | { type: "proposal"; proposal: AssistantProposal }
  | { type: "error"; message: string };

/**
 * External chat state consumed by assistant-ui's ExternalStoreRuntime.
 *
 * The backend emits an event stream, while assistant-ui renders messages made
 * from typed parts. Keeping this small intermediary shape makes that mapping
 * explicit without coupling the backend wire protocol to a UI dependency.
 */
export type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      createdAt: Date;
    }
  | {
      id: string;
      role: "assistant";
      parts: ChatMessagePart[];
      status: ChatMessageStatus;
      createdAt: Date;
    };

/** One frame off the SSE stream. Fields depend on `type`. */
export interface ChatFrame {
  type: string;
  turnId?: string;
  messageId?: string;
  createdAt?: number;
  text?: string;
  toolUseId?: string;
  tool?: string;
  args?: unknown;
  ok?: boolean;
  preview?: string;
  message?: string;
  stopReason?: string;
  costUsd?: number | null;
  proposal?: AssistantProposal;
  proposalId?: string;
  status?: AssistantProposal["status"];
}
