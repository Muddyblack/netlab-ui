import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { resolveThemeMode } from "../../theme";

interface MonacoDiffViewerProps {
  original: string;
  modified: string;
  language: string;
  theme?: "light" | "dark";
  renderSideBySide?: boolean;
  lineNumbers?: "on" | "off";
}

function applyMonacoDiffTheme(mode: "light" | "dark"): string {
  const themeName = `netlab-diff-editor-${mode}`;
  const isLight = mode === "light";
  monaco.editor.defineTheme(themeName, {
    base: isLight ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": isLight ? "#ffffff" : "#1e1e1e",
      "editor.foreground": isLight ? "#1e1e1e" : "#d4d4d4",
    },
  });
  return themeName;
}

export default function MonacoDiffViewer({
  original,
  modified,
  language,
  theme: themeProp,
  renderSideBySide = true,
  lineNumbers = "on",
}: MonacoDiffViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const effectiveTheme = themeProp ?? resolveThemeMode();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const themeName = applyMonacoDiffTheme(effectiveTheme);
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      theme: themeName,
      readOnly: true,
      originalEditable: false,
      minimap: { enabled: false },
      renderSideBySide,
      lineNumbers,
      scrollBeyondLastLine: false,
      fontSize: 12,
      wordWrap: "on",
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });

    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
  }, [language, modified, original, effectiveTheme, renderSideBySide, lineNumbers]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}
