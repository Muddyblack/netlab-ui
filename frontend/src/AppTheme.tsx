import { MuiThemeProvider } from "@containerlab/clab-ui/theme";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

const SEVERITIES = ["error", "warning", "success", "info"] as const;

/**
 * Readability fixes on top of clab-ui's theme, for both modes (the colors are CSS variables set in theme.ts):
 *  - filled chips/buttons in a severity color get a text color that contrasts with it;
 *  - warning alerts get the normal text color: clab-ui's dark palette sets VS Code's warning foreground to
 *    black, which left them black on dark olive.
 */
function withFixes(outer: Theme): Theme {
  const palette = { ...outer.palette };
  for (const severity of SEVERITIES) {
    palette[severity] = { ...palette[severity], contrastText: `var(--netlab-ui-on-${severity})` };
  }
  const alert = outer.components?.MuiAlert;
  const overrides = (alert?.styleOverrides ?? {}) as Record<string, object | undefined>;
  const readable = { color: "var(--vscode-foreground)" };
  return {
    ...outer,
    palette,
    components: {
      ...outer.components,
      MuiAlert: {
        ...alert,
        styleOverrides: {
          ...overrides,
          standardWarning: { ...overrides.standardWarning, ...readable },
          filledWarning: { ...overrides.filledWarning, ...readable },
        },
      },
    },
  };
}

/** clab-ui's theme with netlab-ui's readability fixes; wraps the whole app. */
export function AppTheme({ children }: { children: ReactNode }) {
  return (
    <MuiThemeProvider>
      <ThemeProvider theme={withFixes}>{children}</ThemeProvider>
    </MuiThemeProvider>
  );
}
