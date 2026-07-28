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
  assistantOpen: boolean;
  onToggleAssistant: () => void;
}

export function AppToolbarActions({
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  onToggleNotifications,
  onOpenSettings,
  assistantAvailable,
  assistantOpen,
  onToggleAssistant
}: AppToolbarActionsProps) {
  let notificationTooltip = "Enable system notifications for netlab jobs";
  if (notificationPermission === "denied") notificationTooltip = "Notifications blocked — allow them in this site's browser settings";
  else if (notificationsEnabled) notificationTooltip = "System notifications on — click to turn off";
  let assistantLabel = "Assistant unavailable";
  let assistantState: "offline" | "idle" | "sleeping" = "offline";
  if (assistantAvailable) {
    assistantLabel = assistantOpen ? "Close assistant" : "Open assistant";
    assistantState = assistantOpen ? "idle" : "sleeping";
  }

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Tooltip
        title={
          assistantAvailable
            ? `${assistantOpen ? "Close" : "Open"} AI assistant (Ctrl+I)`
            : "AI assistant — set up a provider to wake Nettie"
        }
        arrow
      >
        <IconButton
          size="small"
          onClick={onToggleAssistant}
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
