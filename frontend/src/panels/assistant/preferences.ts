const OPEN_KEY = "netlab.assistant.open";
const PROVIDER_KEY = "netlab.assistant.provider";
const MODE_KEY = "netlab.assistant.mode";
const MODEL_KEY_PREFIX = "netlab.assistant.model:";

export type AssistantMode = "ask" | "plan" | "build" | "tutor";

export const MODES: Array<{ id: AssistantMode; label: string; description: string }> = [
  { id: "ask", label: "Ask", description: "Explain and investigate without changing the lab" },
  { id: "plan", label: "Plan", description: "Research and produce an implementation plan" },
  { id: "build", label: "Build", description: "Stage topology changes for your approval" },
  { id: "tutor", label: "Tutor", description: "Guide you through the problem step by step" },
];

export function readAssistantOpen(): boolean {
  return read(OPEN_KEY) === "true";
}

export function persistAssistantOpen(open: boolean): void {
  write(OPEN_KEY, String(open));
}

export function readAssistantProvider(): string {
  return read(PROVIDER_KEY) ?? "";
}

export function persistAssistantProvider(providerId: string): void {
  write(PROVIDER_KEY, providerId);
}

/**
 * The model last used with a given provider, kept per-provider so switching
 * back and forth restores each provider's choice. Seeding this synchronously
 * on mount avoids the window where a configurable provider's model is still
 * "" and a chat would be created (then orphaned) under the wrong key.
 */
export function readAssistantModel(providerId: string): string {
  return (providerId && read(MODEL_KEY_PREFIX + providerId)) || "";
}

export function persistAssistantModel(providerId: string, model: string): void {
  if (providerId && model) write(MODEL_KEY_PREFIX + providerId, model);
}

export function readAssistantMode(): AssistantMode {
  const value = read(MODE_KEY);
  if (value === "plan" || value === "build" || value === "tutor") return value;
  return "ask";
}

export function persistAssistantMode(mode: string): void {
  if (mode === "ask" || mode === "plan" || mode === "build" || mode === "tutor") {
    write(MODE_KEY, mode);
  }
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are best-effort in private or sandboxed browser contexts.
  }
}
