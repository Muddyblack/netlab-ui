import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyResolvedThemeVars, readPersistedThemeMode, resolveThemeMode } from "./theme";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import YamlWorker from "monaco-yaml/yaml.worker.js?worker";

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
};

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => {
      if (label === "json") return new JsonWorker();
      if (label === "yaml") return new YamlWorker();
      return new EditorWorker();
    }
  };
}

function syncThemeVars(): void {
  applyResolvedThemeVars(resolveThemeMode());
}

// Initialize theme variables before mounting React and keep them synced.
syncThemeVars();
// Paint the themed background before React mounts — otherwise a pop-out
// session window (a bare, fast-loading page) flashes white for a beat.
document.body.style.backgroundColor = "var(--vscode-editor-background, #1e1e1e)";

// The left-side explorer panel (isDevMock) and the palette panel conflict when
// the palette is on the left. Force the palette to the right side so the
// explorer is always visible.
try {
  if (window.localStorage.getItem("contextPanelSide") === "left") {
    window.localStorage.removeItem("contextPanelSide");
  }
} catch { /* ignore */ }

if (typeof window !== "undefined") {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = () => {
    if (!readPersistedThemeMode()) {
      syncThemeVars();
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleThemeChange);
  } else {
    mediaQuery.addListener(handleThemeChange);
  }
}

// ?popout=shell|logs renders a single session in its own window instead of the
// full app — the session dock's "move to its own window" target.
function resolvePopout(): { kind: "shell" | "logs"; node: string; sessionId: string } | null {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("popout");
  const node = params.get("node");
  const sessionId = params.get("sessionId");
  if ((kind !== "shell" && kind !== "logs") || !node || !sessionId) return null;
  return { kind, node, sessionId };
}

// ?popout=assistant needs no node — the conversation is about the whole lab.
function resolveAssistantPopout(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("popout") !== "assistant") return null;
  return params.get("sessionId");
}

const popout = resolvePopout();
const assistantPopout = resolveAssistantPopout();
const SessionPopout = lazy(() => import("./terminal/SessionPopout").then((m) => ({ default: m.SessionPopout })));
const AssistantPopout = lazy(() =>
  import("./panels/assistant/AssistantPopout").then((m) => ({ default: m.AssistantPopout }))
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {popout ? (
      <Suspense fallback={null}>
        <SessionPopout kind={popout.kind} node={popout.node} sessionId={popout.sessionId} />
      </Suspense>
    ) : assistantPopout ? (
      <Suspense fallback={null}>
        <AssistantPopout sessionId={assistantPopout} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
