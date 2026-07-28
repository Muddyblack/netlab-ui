import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";

interface GeneratedConfigViewerProps {
  content: string;
  path: string;
  theme: "light" | "dark";
}

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (/\.(sh|bash|zsh)$/.test(lower)) return "shell";
  if (/\.(ya?ml)$/.test(lower)) return "yaml";
  if (/\.json$/.test(lower)) return "json";
  if (/\.(ini|conf|cfg)$/.test(lower)) return "ini";
  return "plaintext";
}

export default function GeneratedConfigViewer({ content, path, theme }: GeneratedConfigViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const model = monaco.editor.createModel(content, languageForPath(path));
    const editor = monaco.editor.create(containerRef.current, {
      model,
      automaticLayout: true,
      theme: theme === "light" ? "vs" : "vs-dark",
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 12,
      lineNumbersMinChars: 3,
      folding: true,
      wordWrap: "off",
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
    });

    return () => {
      editor.dispose();
      model.dispose();
    };
  }, [content, path, theme]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 0 }} />;
}
