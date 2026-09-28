import { IconButton, Stack, Tooltip } from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import SettingsIcon from "@mui/icons-material/Settings";
import { NetlabMascot } from "../components/agents/NetlabMascot";

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

function notificationTooltipFor(notificationsEnabled: boolean, notificationPermission: NotificationPermission | "unavailable"): string {
  if (notificationPermission === "denied") return "Notifications blocked — allow them in this site's browser settings";
  if (notificationsEnabled) return "System notifications on — click to turn off";
  return "Enable system notifications for netlab jobs";
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
  const notificationTooltip = notificationTooltipFor(notificationsEnabled, notificationPermission);

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {assistantAvailable && (
        <Tooltip title={`${assistantOpen ? "Close" : "Open"} AI agents: connect your own agent over MCP (Ctrl+I)`} arrow>
          <IconButton
            size="small"
            onClick={onToggleAssistant}
            color={assistantOpen ? "warning" : "default"}
            aria-label={assistantOpen ? "Close AI agents panel" : "Open AI agents panel"}
            sx={{ opacity: 1, "&:hover": { opacity: 1 } }}
          >
            <NetlabMascot size={20} state={assistantOpen ? "idle" : "sleeping"} />
          </IconButton>
        </Tooltip>
      )}

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
