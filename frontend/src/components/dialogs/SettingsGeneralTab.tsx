import { useEffect, useState, type ReactNode } from "react";
import { Alert, Box, Button, Card, CardActionArea, Chip, Divider, Stack, Switch, Typography } from "@mui/material";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import type { AppThemeMode } from "../../theme";
import {
  DEFAULT_TERMINAL_SHORTCUT, isReservedShortcutKey, setTerminalShortcut, shortcutFromEvent, terminalShortcutLabel, useTerminalShortcut
} from "../../app/terminalShortcut";

/** Pick the key that shows or hides the terminal panel: press it while this is listening. */
function TerminalShortcutSetting() {
  const shortcut = useTerminalShortcut();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return setListening(false);
      if (isReservedShortcutKey(event)) return undefined;
      setTerminalShortcut(shortcutFromEvent(event));
      return setListening(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening]);
  const isDefault = shortcut === DEFAULT_TERMINAL_SHORTCUT;
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={650} gutterBottom>
        Terminal Shortcut
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        The key that shows or hides the terminal panel, together with Ctrl (Cmd on a Mac). With Shift it opens another terminal.
        The default is the backtick, which some keyboard layouts (German, for one) don't have as a plain key: pick any other key there.
      </Typography>
      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              {listening ? "Press the key to use (Esc cancels)…" : terminalShortcutLabel(shortcut)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isDefault ? "Default" : `Default is ${terminalShortcutLabel(DEFAULT_TERMINAL_SHORTCUT)}`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => setListening((value) => !value)}>{listening ? "Cancel" : "Change"}</Button>
            <Button size="small" disabled={isDefault} onClick={() => setTerminalShortcut(DEFAULT_TERMINAL_SHORTCUT)}>Reset</Button>
          </Stack>
        </Stack>
      </Card>
    </Box>
  );
}

function describeNotificationText(notificationsEnabled: boolean, notificationPermission: NotificationPermission | "unavailable"): string {
  if (notificationPermission === "denied") return "Notifications blocked by browser settings";
  if (notificationsEnabled) return "Desktop notifications are active";
  return "System notifications for netlab background jobs";
}

function ThemeOptionCard({
  active,
  onSelect,
  icon,
  title,
  description
}: {
  active: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card
      variant={active ? "elevation" : "outlined"}
      elevation={active ? 4 : 0}
      sx={{
        flex: 1,
        border: active ? 2 : 1,
        borderColor: active ? "primary.main" : "divider"
      }}
    >
      <CardActionArea onClick={active ? undefined : onSelect} sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ color: active ? "primary.main" : "text.secondary" }}>{icon}</Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>{title}</Typography>
            <Typography variant="caption" color="text.secondary">{description}</Typography>
          </Box>
          {active && <Chip size="small" color="primary" label="Active" />}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export interface SettingsGeneralTabProps {
  themeMode: AppThemeMode;
  onToggleTheme: () => void;
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | "unavailable";
  onToggleNotifications: () => void;
}

export function SettingsGeneralTab({
  themeMode,
  onToggleTheme,
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  onToggleNotifications
}: SettingsGeneralTabProps) {
  const notificationText = describeNotificationText(notificationsEnabled, notificationPermission);

  return (
    <Stack spacing={3.5}>
      <Box>
        <Typography variant="subtitle2" fontWeight={650} gutterBottom>
          Appearance Theme
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Choose your preferred color scheme for netlab GUI.
        </Typography>
        <Stack direction="row" spacing={2}>
          <ThemeOptionCard
            active={themeMode === "dark"}
            onSelect={onToggleTheme}
            icon={<DarkModeIcon />}
            title="Dark Mode"
            description="Sleek, dark contrast canvas"
          />
          <ThemeOptionCard
            active={themeMode === "light"}
            onSelect={onToggleTheme}
            icon={<LightModeIcon />}
            title="Light Mode"
            description="Clean high-contrast theme"
          />
        </Stack>
      </Box>

      <Divider />

      <TerminalShortcutSetting />

      <Divider />

      <Box>
        <Typography variant="subtitle2" fontWeight={650} gutterBottom>
          System Notifications
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
          Receive desktop notifications when background netlab create, up, or destroy commands complete.
        </Typography>
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box sx={{ color: notificationsEnabled ? "warning.main" : "text.secondary" }}>
                {notificationsEnabled ? <NotificationsActiveIcon /> : <NotificationsOffIcon />}
              </Box>
              <Box>
                <Typography variant="subtitle2" fontWeight={600}>
                  Desktop Notifications
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {notificationText}
                </Typography>
              </Box>
            </Stack>
            <Switch
              checked={notificationsEnabled}
              onChange={onToggleNotifications}
              disabled={!notificationsSupported || notificationPermission === "denied"}
            />
          </Stack>
          {notificationPermission === "denied" && (
            <Alert severity="warning" sx={{ mt: 1.5, py: 0.5 }}>
              Notifications are currently blocked in your browser settings for this site.
            </Alert>
          )}
        </Card>
      </Box>
    </Stack>
  );
}
