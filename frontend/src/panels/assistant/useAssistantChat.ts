import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";

import {
  api,
  type AssistantChatInfo,
  type AssistantProposal,
} from "../../api/client";
import type {
  ChatFrame,
  ChatMessage,
  ChatMessagePart,
  ChatMessageStatus,
} from "./types";

const SUGGESTIONS = [
  { prompt: "Explain what this topology does." },
  { prompt: "Add a third router running BGP, peered with r1." },
  { prompt: "Why did the last deployment fail?" },
  { prompt: "Check whether every node can reach the others." },
];

/**
 * Bridges the netlab SSE chat protocol to assistant-ui's external store.
 *
 * netlab continues to own provider sessions and tool execution. assistant-ui
 * owns the interaction semantics around the resulting thread: composer state,
 * cancellation, auto-scroll, accessibility, suggestions, and message status.
 */
export function useAssistantChat(
  sessionId: string,
  providerId: string,
  mode: string,
  model: string,
  selection: string[],
  // False while a configurable provider hasn't resolved its model yet: sending
  // then would create a chat keyed on an empty model that vanishes the moment
  // the real model resolves and re-keys the conversation.
  ready: boolean
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<AssistantChatInfo[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chatId = useRef<string | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const restoreGeneration = useRef(0);
  // The provider/model the active chat is actually running on right now —
  // distinct from the `providerId`/`model` args, which are just what's
  // selected in the composer. Compared on send so a provider/model change
  // switches the existing chat's backend instead of starting a new thread.
  const activeChatProvider = useRef<{ providerId: string; model: string } | null>(null);

  const setRunning = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const push = useCallback(
    (frame: ChatFrame) => {
      setMessages((current) => foldChatFrame(current, frame));
      if (frame.type === "turn_started") setRunning(true);
      if (frame.type === "turn_done") setRunning(false);
    },
    [setRunning]
  );

  const disconnect = useCallback(() => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    chatId.current = null;
    activeChatProvider.current = null;
  }, []);

  const reset = useCallback(() => {
    disconnect();
    setActiveChatId(null);
    setMessages([]);
    setRunning(false);
    clearStoredChat(sessionId, mode);
  }, [disconnect, mode, sessionId, setRunning]);

  const refreshThreads = useCallback(async () => {
    const result = await api.listAssistantChats(sessionId);
    setThreads(result.chats ?? []);
    return result.chats ?? [];
  }, [sessionId]);

  const loadChat = useCallback(
    (id: string, resolvedProvider?: { providerId: string; model: string }) => {
      const generation = ++restoreGeneration.current;
      disconnect();
      setMessages([]);
      setRunning(false);
      setActiveChatId(id);
      chatId.current = id;
      activeChatProvider.current = resolvedProvider ?? null;
      writeStoredChat(sessionId, mode, id);
      // Replay history and continue live over one gap-free stream: `push`
      // folds the replayed frames and then the live ones, driving running
      // state from turn_started/turn_done so no separate snapshot is needed.
      unsubscribe.current = api.subscribeAssistantChat(
        id,
        (frame) => {
          if (restoreGeneration.current !== generation) return;
          push(frame as unknown as ChatFrame);
        },
        { replay: true }
      );
    },
    [disconnect, mode, push, sessionId, setRunning]
  );

  // Restore the matching thread after a page refresh. A mode change opens a
  // clean draft while leaving older conversations in history; a provider/model
  // change does not — see `ensureChat`, which switches the existing thread.
  useEffect(() => {
    const generation = ++restoreGeneration.current;
    disconnect();
    setMessages([]);
    setActiveChatId(null);
    setRunning(false);

    void refreshThreads()
      .then((availableThreads) => {
        if (restoreGeneration.current !== generation) return;
        const stored = readStoredChat(sessionId, mode);
        const match = availableThreads.find((thread) => thread.chatId === stored && thread.mode === mode);
        if (match) loadChat(match.chatId, { providerId: match.providerId, model: match.model ?? "" });
      })
      .catch(() => undefined);

    return () => {
      restoreGeneration.current += 1;
      disconnect();
    };
  }, [disconnect, loadChat, mode, refreshThreads, sessionId, setRunning]);

  const ensureChat = useCallback(async () => {
    if (chatId.current) {
      const current = activeChatProvider.current;
      if (current && (current.providerId !== providerId || current.model !== model)) {
        const chat = await api.switchAssistantChatProvider(chatId.current, providerId, model);
        activeChatProvider.current = { providerId, model };
        setThreads((cur) => cur.map((item) => (item.chatId === chat.chatId ? chat : item)));
      }
      return chatId.current;
    }
    const chat = await api.createAssistantChat(providerId, sessionId, mode, model);
    chatId.current = chat.chatId;
    activeChatProvider.current = { providerId, model };
    setActiveChatId(chat.chatId);
    setThreads((current) => [chat, ...current.filter((item) => item.chatId !== chat.chatId)]);
    writeStoredChat(sessionId, mode, chat.chatId);
    unsubscribe.current = api.subscribeAssistantChat(chat.chatId, (frame) =>
      push(frame as unknown as ChatFrame)
    );
    return chat.chatId;
  }, [model, providerId, push, sessionId, mode]);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current || !ready) return;

      sequence.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}-${sequence.current}`,
          role: "user",
          text: trimmed,
          createdAt: new Date(),
        },
      ]);
      setRunning(true);

      try {
        const id = await ensureChat();
        await api.sendAssistantMessage(id, trimmed, selection);
        void refreshThreads().catch(() => undefined);
      } catch (err) {
        setRunning(false);
        const message = err instanceof Error ? err.message : String(err);
        setMessages((current) => appendStandaloneError(current, message));
      }
    },
    [ensureChat, ready, refreshThreads, selection, setRunning]
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> =>
          part.type === "text"
        )
        .map((part) => part.text)
        .join("\n");
      await sendText(text);
    },
    [sendText]
  );

  const cancel = useCallback(async () => {
    if (!chatId.current) return;
    await api.cancelAssistantTurn(chatId.current).catch(() => undefined);
  }, []);

  const setProposalStatus = useCallback(
    (proposalId: string, status: AssistantProposal["status"]) => {
      setMessages((current) => updateProposalStatus(current, proposalId, status));
    },
    []
  );

  // Threads are scoped by mode, not by provider/model: a conversation keeps
  // its place in history across a provider switch instead of forking into a
  // separate per-provider list.
  const visibleThreads = useMemo(() => threads.filter((thread) => thread.mode === mode), [mode, threads]);

  const deleteThread = useCallback(
    async (threadId: string) => {
      await api.deleteAssistantChat(threadId);
      setThreads((current) => current.filter((thread) => thread.chatId !== threadId));
      if (chatId.current === threadId) reset();
    },
    [reset]
  );

  const switchToThread = useCallback(
    (id: string) => {
      const info = threads.find((thread) => thread.chatId === id);
      loadChat(id, info ? { providerId: info.providerId, model: info.model ?? "" } : undefined);
    },
    [loadChat, threads]
  );

  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning: busy,
    isSendDisabled: !ready,
    suggestions: SUGGESTIONS,
    onNew,
    onCancel: cancel,
    convertMessage,
    adapters: {
      threadList: {
        threadId: activeChatId ?? undefined,
        threads: visibleThreads.map((thread) => ({
          id: thread.chatId,
          status: "regular" as const,
          title: thread.title,
        })),
        archivedThreads: [],
        onSwitchToNewThread: reset,
        onSwitchToThread: switchToThread,
        onDelete: deleteThread,
      },
    },
    unstable_capabilities: { copy: true },
  });

  return {
    runtime,
    messages,
    busy,
    reset,
    setProposalStatus,
    threadCount: visibleThreads.length,
  };
}

function convertMessage(message: ChatMessage): ThreadMessageLike {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      createdAt: message.createdAt,
      content: [{ type: "text", text: message.text }],
    };
  }

  return {
    id: message.id,
    role: "assistant",
    createdAt: message.createdAt,
    status: message.status,
    content: message.parts.map(convertPart),
  };
}

function convertPart(part: ChatMessagePart): NonNullable<ThreadMessageLike["content"]> extends string
  ? never
  : Exclude<ThreadMessageLike["content"], string>[number] {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: asToolArgs(part.args),
        argsText: JSON.stringify(part.args ?? {}, null, 2),
        ...(part.result !== undefined ? { result: part.result } : {}),
        ...(part.isError !== undefined ? { isError: part.isError } : {}),
      };
    case "proposal":
      return { type: "data-proposal", data: part.proposal };
    case "error":
      return { type: "data-error", data: { message: part.message } };
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };

function asToolArgs(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : { value: jsonValue(value) };
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function foldUserMessage(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  if (!frame.text) return messages;
  return [
    ...messages,
    {
      id: frame.messageId ?? `user-${messages.length}`,
      role: "user",
      text: frame.text,
      createdAt: frame.createdAt ? new Date(frame.createdAt * 1000) : new Date(),
    },
  ];
}

function foldTextDelta(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  return updateAssistantTurn(messages, frame.turnId, (parts) => {
    const last = parts.at(-1);
    if (last?.type === "text") {
      return [...parts.slice(0, -1), { ...last, text: last.text + (frame.text ?? "") }];
    }
    return [...parts, { type: "text", text: frame.text ?? "" }];
  });
}

function foldToolCall(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  return updateAssistantTurn(messages, frame.turnId, (parts) => [
    ...parts,
    {
      type: "tool",
      toolCallId: frame.toolUseId ?? `tool-${parts.length}`,
      toolName: frame.tool ?? "tool",
      args: frame.args,
    },
  ]);
}

function foldToolResult(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  return updateAssistantTurn(messages, frame.turnId, (parts) =>
    parts.map((part) =>
      part.type === "tool" && part.toolCallId === frame.toolUseId
        ? {
            ...part,
            result: frame.preview ?? (frame.ok === false ? "Tool call failed." : "Completed."),
            isError: frame.ok === false,
          }
        : part
    )
  );
}

function foldProposal(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  if (!frame.proposal) return messages;
  return updateAssistantTurn(messages, frame.turnId, (parts) => [
    ...parts,
    { type: "proposal", proposal: frame.proposal! },
  ]);
}

function foldProposalUpdate(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  if (!frame.proposalId || !frame.status) return messages;
  return updateProposalStatus(messages, frame.proposalId, frame.status);
}

function foldError(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  return updateAssistantTurn(messages, frame.turnId, (parts) => [
    ...parts,
    { type: "error", message: frame.message ?? "Unknown assistant error." },
  ]);
}

/** Fold one backend frame into a structured assistant-ui-compatible thread. */
export function foldChatFrame(messages: ChatMessage[], frame: ChatFrame): ChatMessage[] {
  switch (frame.type) {
    case "user_message":
      return foldUserMessage(messages, frame);
    case "turn_started":
      return ensureAssistantTurn(messages, frame.turnId);
    case "text_delta":
      return foldTextDelta(messages, frame);
    case "tool_call":
      return foldToolCall(messages, frame);
    case "tool_result":
      return foldToolResult(messages, frame);
    case "proposal":
      return foldProposal(messages, frame);
    case "proposal_update":
      return foldProposalUpdate(messages, frame);
    case "error":
      return foldError(messages, frame);
    case "turn_done":
      return finishAssistantTurn(messages, frame.turnId, frame.stopReason);
    default:
      return messages;
  }
}

function ensureAssistantTurn(messages: ChatMessage[], turnId?: string): ChatMessage[] {
  const id = turnId ?? `assistant-${Date.now()}`;
  if (messages.some((message) => message.role === "assistant" && message.id === id)) return messages;
  return [
    ...messages,
    {
      id,
      role: "assistant",
      parts: [],
      status: { type: "running" },
      createdAt: new Date(),
    },
  ];
}

function updateAssistantTurn(
  messages: ChatMessage[],
  turnId: string | undefined,
  update: (parts: ChatMessagePart[]) => ChatMessagePart[]
): ChatMessage[] {
  let index = turnId
    ? messages.findIndex((message) => message.role === "assistant" && message.id === turnId)
    : -1;

  if (index < 0) {
    for (let candidate = messages.length - 1; candidate >= 0; candidate -= 1) {
      const message = messages[candidate];
      if (message.role === "assistant" && message.status.type === "running") {
        index = candidate;
        break;
      }
    }
  }

  const next = index < 0 ? ensureAssistantTurn(messages, turnId) : messages;
  const targetIndex = index < 0 ? next.length - 1 : index;
  return next.map((message, messageIndex) =>
    messageIndex === targetIndex && message.role === "assistant"
      ? { ...message, parts: update(message.parts) }
      : message
  );
}

function finishAssistantTurn(
  messages: ChatMessage[],
  turnId: string | undefined,
  stopReason?: string
): ChatMessage[] {
  const status = statusFromStopReason(stopReason);
  return messages.map((message) =>
    message.role === "assistant" &&
    ((turnId && message.id === turnId) || (!turnId && message.status.type === "running"))
      ? { ...message, status }
      : message
  );
}

function statusFromStopReason(stopReason?: string): ChatMessageStatus {
  switch (stopReason) {
    case "cancelled":
      return { type: "incomplete", reason: "cancelled" };
    case "error":
      return { type: "incomplete", reason: "error" };
    case "length":
      return { type: "incomplete", reason: "length" };
    case "content_filter":
      return { type: "incomplete", reason: "content-filter" };
    default:
      return { type: "complete", reason: "stop" };
  }
}

function updateProposalStatus(
  messages: ChatMessage[],
  proposalId: string,
  status: AssistantProposal["status"]
): ChatMessage[] {
  return messages.map((message) =>
    message.role === "assistant"
      ? {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "proposal" && part.proposal.id === proposalId
              ? { ...part, proposal: { ...part.proposal, status } }
              : part
          ),
        }
      : message
  );
}

function appendStandaloneError(messages: ChatMessage[], error: string): ChatMessage[] {
  return [
    ...messages,
    {
      id: `assistant-error-${Date.now()}`,
      role: "assistant",
      parts: [{ type: "error", message: error }],
      status: { type: "incomplete", reason: "error", error },
      createdAt: new Date(),
    },
  ];
}

function storedChatKey(sessionId: string, mode: string): string {
  return `netlab.assistant.activeChat:${sessionId}:${mode}`;
}

function readStoredChat(sessionId: string, mode: string): string | null {
  try {
    return window.localStorage.getItem(storedChatKey(sessionId, mode));
  } catch {
    return null;
  }
}

function writeStoredChat(sessionId: string, mode: string, chatId: string): void {
  try {
    window.localStorage.setItem(storedChatKey(sessionId, mode), chatId);
  } catch {
    // History still works for the current page when storage is unavailable.
  }
}

function clearStoredChat(sessionId: string, mode: string): void {
  try {
    window.localStorage.removeItem(storedChatKey(sessionId, mode));
  } catch {
    // Best-effort preference cleanup.
  }
}
