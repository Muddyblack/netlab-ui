import { IconButton, Stack, Tooltip } from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import SettingsIcon from "@mui/icons-material/Settings";
import { NetlabMascot } from "../panels/assistant/NetlabMascot";

import { blurTrigger } from "../utils/focus";

interface AppToolbarActionsProps {
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | "unavailable";
  onToggleNotifications: () => void;
  onOpenSettings: () => void;
  assistantAvailable: boolean;
  assistantHasProvider: boolean;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  onSetupAssistant: () => void;
}

function notificationTooltipFor(notificationsEnabled: boolean, notificationPermission: NotificationPermission | "unavailable"): string {
  if (notificationPermission === "denied") return "Notifications blocked — allow them in this site's browser settings";
  if (notificationsEnabled) return "System notifications on — click to turn off";
  return "Enable system notifications for netlab jobs";
}

function assistantStatusFor(assistantAvailable: boolean, assistantHasProvider: boolean, assistantOpen: boolean): {
  label: string;
  state: "offline" | "idle" | "sleeping";
} {
  if (assistantAvailable && assistantHasProvider) {
    return { label: assistantOpen ? "Close assistant" : "Open assistant", state: assistantOpen ? "idle" : "sleeping" };
  }
  if (assistantAvailable) {
    return { label: "Set up an AI provider", state: "sleeping" };
  }
  return { label: "Assistant unavailable", state: "offline" };
}

export function AppToolbarActions({
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  onToggleNotifications,
  onOpenSettings,
  assistantAvailable,
  assistantHasProvider,
  assistantOpen,
  onToggleAssistant,
  onSetupAssistant
}: AppToolbarActionsProps) {
  const notificationTooltip = notificationTooltipFor(notificationsEnabled, notificationPermission);
  const { label: assistantLabel, state: assistantState } = assistantStatusFor(assistantAvailable, assistantHasProvider, assistantOpen);

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Tooltip
        title={
          assistantAvailable && assistantHasProvider
            ? `${assistantOpen ? "Close" : "Open"} AI assistant (Ctrl+I)`
            : "AI assistant — set up a provider to wake Nettie"
        }
        arrow
      >
        <IconButton
          size="small"
          onClick={assistantHasProvider ? onToggleAssistant : onSetupAssistant}
          color={assistantOpen ? "warning" : "default"}
          aria-label={assistantLabel}
          sx={{ opacity: 1, "&:hover": { opacity: 1 } }}
        >
          <NetlabMascot size={20} state={assistantState} />
        </IconButton>
      </Tooltip>

      {notificationsSupported && (
        <Tooltip title={notificationTooltip} arrow>
          <IconButton
            size="small"
            onClick={onToggleNotifications}
            color={notificationsEnabled ? "warning" : "default"}
            aria-label={notificationsEnabled ? "Disable system notifications" : "Enable system notifications"}
          >
            {notificationsEnabled
              ? <NotificationsActiveIcon fontSize="small" />
              : <NotificationsOffIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title="Settings & Preferences" arrow>
        <IconButton
          size="small"
          onClick={(e) => {
            blurTrigger(e.currentTarget);
            onOpenSettings();
          }}
          aria-label="Settings & Preferences"
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
