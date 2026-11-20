import { Box, ButtonBase, useMediaQuery } from "@mui/material";
import type { Terminal } from "@xterm/xterm";
import type { RefObject } from "react";

type Key = { label: string; title: string; data: (term: Terminal) => string };

// Arrows follow the terminal's cursor-key mode: full-screen programs (agent CLIs, vim, menus) switch to
// "application" mode and expect ESC O A rather than ESC [ A.
const arrow = (code: string) => (term: Terminal) => (term.modes.applicationCursorKeysMode ? `\x1bO${code}` : `\x1b[${code}`);

const KEYS: Key[] = [
  { label: "Esc", title: "Escape", data: () => "\x1b" },
  { label: "Tab", title: "Tab", data: () => "\t" },
  { label: "↑", title: "Up", data: arrow("A") },
  { label: "↓", title: "Down", data: arrow("B") },
  { label: "←", title: "Left", data: arrow("D") },
  { label: "→", title: "Right", data: arrow("C") },
  { label: "⏎", title: "Enter", data: () => "\r" },
  { label: "^C", title: "Ctrl+C", data: () => "\x03" },
];

/**
 * The keys a phone keyboard does not have, for touch screens only. Terminal programs are driven by keys, not taps:
 * without arrows, Esc and Tab an agent's menus (e.g. "Yes, I trust this folder") could not be answered on a phone.
 * Keys go through `term.input`, the same path as typing, so synced shells get them too.
 */
export function TouchKeys({ termRef }: { termRef: RefObject<Terminal | null> }) {
  const touch = useMediaQuery("(pointer: coarse)");
  if (!touch) return null;
  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.5,
        px: 1,
        py: 0.5,
        overflowX: "auto",
        scrollbarWidth: "none",
        flex: "none",
        borderTop: "1px solid var(--vscode-panel-border, #3c3c3c)",
        bgcolor: "var(--vscode-sideBar-background, #252526)",
      }}
    >
      {KEYS.map((key) => (
        <ButtonBase
          key={key.title}
          aria-label={key.title}
          // Keep the focus (and the phone keyboard) in the terminal.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const term = termRef.current;
            if (!term) return;
            term.input(key.data(term), true);
            term.focus();
          }}
          sx={{
            flex: "1 0 auto",
            minWidth: 40,
            height: 36,
            px: 1,
            borderRadius: 1,
            border: "1px solid var(--vscode-panel-border, #3c3c3c)",
            bgcolor: "var(--vscode-editor-background, #1e1e1e)",
            color: "text.primary",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            "&:active": { bgcolor: "action.selected" },
          }}
        >
          {key.label}
        </ButtonBase>
      ))}
    </Box>
  );
}
