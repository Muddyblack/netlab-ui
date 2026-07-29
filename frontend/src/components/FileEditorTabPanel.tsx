import * as monaco from "monaco-editor";
import React, { useCallback, useEffect, useRef } from "react";

export interface FileEditorTabData {
  id: string;
  title: string;
  path: string;
  content: string;
  originalContent: string;
  saving: boolean;
  error?: string;
  staleOnDisk?: boolean;
}

interface FileEditorTabPanelProps {
  tab: FileEditorTabData;
  themeMode: string;
  onChange: (tabId: string, content: string) => void;
  onClose: (tabId: string) => void;
  onSave: (tabId: string) => void;
  onReload: (tabId: string) => void;
}


const PANEL_BG = "var(--clab-ui-editor-background, var(--vscode-editor-background, #1e1e1e))";
const PANEL_FG = "var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #d4d4d4))";
const BORDER = "var(--vscode-panel-border, rgba(128, 128, 128, 0.35))";
const BUTTON_BG = "var(--vscode-button-background, #0e639c)";
const BUTTON_FG = "var(--vscode-button-foreground, #ffffff)";
const DISABLED_BG = "var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.25))";
const ERROR_BG = "var(--vscode-inputValidation-errorBackground, rgba(127, 29, 29, 0.35))";
const ERROR_BORDER = "var(--vscode-inputValidation-errorBorder, #be1100)";
const WARN_BG = "var(--vscode-inputValidation-warningBackground, rgba(120, 90, 10, 0.35))";
const WARN_BORDER = "var(--vscode-inputValidation-warningBorder, #b89500)";
const TAB_BAR_OFFSET = 45;

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\.(ya?ml)$/, "yaml"],
  [/\.json$/, "json"],
  [/\.md$/, "markdown"],
  [/\.py$/, "python"],
  [/\.(ts|tsx)$/, "typescript"],
  [/\.(js|jsx|mjs|cjs)$/, "javascript"],
  [/\.(sh|bash|zsh)$/, "shell"],
  [/\.(ini|conf|cfg)$/, "ini"],
];


function sniffLanguage(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed) return "plaintext";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "plaintext";
}

function languageForDocument(pathValue: string, content: string): string {
  const fileName = pathValue.split("/").pop()?.toLowerCase() ?? pathValue.toLowerCase();
  return LANGUAGE_PATTERNS.find(([pattern]) => pattern.test(fileName))?.[1] ?? sniffLanguage(content);
}

function getCssVar(name: string, fallback: string): string {
  return window.getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function applyMonacoTheme(mode: string): string {
  const themeName = `netlab-file-editor-${mode}`;
  const isLight = mode === "light";
  monaco.editor.defineTheme(themeName, {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": getCssVar("--clab-ui-editor-background", isLight ? "#ffffff" : "#1e1e1e"),
      "editor.foreground": getCssVar("--clab-ui-editor-foreground", isLight ? "#333333" : "#d4d4d4"),
    }
  });
  monaco.editor.setTheme(themeName);
  return themeName;
}


export function FileEditorTabPanel({
  tab,
  themeMode,
  onChange,
  onClose,
  onSave,
  onReload
}: FileEditorTabPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const dirty = tab.content !== tab.originalContent;
  const themeModeRef = useRef(themeMode);

  useEffect(() => {
    themeModeRef.current = themeMode;
  }, [themeMode]);

  const handleSave = useCallback(() => {
    onSave(tab.id);
  }, [onSave, tab.id]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const theme = applyMonacoTheme(themeModeRef.current);
    const language = languageForDocument(tab.path, tab.content);
    const editor = monaco.editor.create(containerRef.current, {
      value: tab.content,
      language,
      theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      wordWrap: "on",
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, handleSave);
    editorRef.current = editor;
    const subscription = editor.onDidChangeModelContent(() => {
      onChange(tab.id, editor.getValue());
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [handleSave, onChange, tab.id, tab.path]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.getValue() !== tab.content) {
      editorRef.current.setValue(tab.content);
    }
  }, [tab.content]);

  useEffect(() => {
    const theme = applyMonacoTheme(themeMode);
    if (editorRef.current) {
      monaco.editor.setTheme(theme);
    }
  }, [themeMode]);


  return (
    <div
      data-testid="file-editor-tab-panel"
      style={{
        position: "absolute",
        top: TAB_BAR_OFFSET,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        color: PANEL_FG,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          padding: "0 12px",
          borderBottom: `1px solid ${BORDER}`,
          boxSizing: "border-box",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tab.title}
            {dirty ? " *" : ""}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              opacity: 0.75,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tab.path}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onClose(tab.id)}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 4,
            border: `1px solid ${BORDER}`,
            backgroundColor: "transparent",
            color: PANEL_FG,
            cursor: "pointer",
          }}
        >
          Close
        </button>
        <button
          type="button"
          data-testid="file-editor-tab-save"
          disabled={!dirty || tab.saving}
          onClick={handleSave}
          style={{
            height: 28,
            minWidth: 70,
            padding: "0 12px",
            borderRadius: 4,
            border: "none",
            backgroundColor: dirty && !tab.saving ? BUTTON_BG : DISABLED_BG,
            color: BUTTON_FG,
            cursor: dirty && !tab.saving ? "pointer" : "default",
            opacity: dirty && !tab.saving ? 1 : 0.65,
          }}
        >
          {tab.saving ? "Saving..." : "Save"}
        </button>
      </div>
      {tab.staleOnDisk ? (
        <div
          data-testid="file-editor-tab-stale"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 12px",
            borderBottom: `1px solid ${WARN_BORDER}`,
            backgroundColor: WARN_BG,
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1 }}>
            This file changed on disk. Your unsaved edits were kept — reload to take the newer version (discards your edits).
          </span>
          <button
            type="button"
            data-testid="file-editor-tab-reload"
            onClick={() => onReload(tab.id)}
            style={{
              height: 26,
              padding: "0 10px",
              borderRadius: 4,
              border: `1px solid ${WARN_BORDER}`,
              backgroundColor: "transparent",
              color: PANEL_FG,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Reload from disk
          </button>
        </div>
      ) : null}
      {tab.error ? (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: `1px solid ${ERROR_BORDER}`,
            backgroundColor: ERROR_BG,
            fontSize: 12,
          }}
        >
          {tab.error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-testid="file-editor-tab-monaco"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  );
}
