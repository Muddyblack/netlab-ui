import { IconButton, Stack, Tooltip } from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import { NetlabMascot } from "../components/agents/NetlabMascot";
import { terminalShortcutLabel, useQuickOpenShortcut } from "./terminalShortcut";

import { blurTrigger } from "../utils/focus";

interface AppToolbarActionsProps {
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | "unavailable";
  onToggleNotifications: () => void;
  onOpenSettings: () => void;
  onQuickOpen: () => void;
  assistantOpen: boolean;
  /** "connecting": the backend has not answered yet (it is retried); "absent": it runs without the feature. */
  assistantStatus: "connecting" | "ready" | "absent";
  hasLab: boolean;
  onToggleAssistant: () => void;
}

function assistantTooltip(status: AppToolbarActionsProps["assistantStatus"], open: boolean, hasLab: boolean): string {
  if (status === "absent") return "AI agents are not available: this backend runs without the assistant feature";
  if (status === "connecting") return "AI agents: waiting for the backend, retrying (click to retry now)";
  const action = `${open ? "Close" : "Open"} AI agents: connect your own agent over MCP (Ctrl+I)`;
  return hasLab ? action : `${action}. The panel sits next to a lab: open one first`;
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
  onQuickOpen,
  assistantOpen,
  assistantStatus,
  hasLab,
  onToggleAssistant
}: AppToolbarActionsProps) {
  const notificationTooltip = notificationTooltipFor(notificationsEnabled, notificationPermission);
  const quickOpenShortcut = useQuickOpenShortcut();

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Tooltip title={`Quick open: labs, files, nodes and commands (${terminalShortcutLabel(quickOpenShortcut)})`} arrow>
        <IconButton
          size="small"
          onClick={(e) => {
            blurTrigger(e.currentTarget);
            onQuickOpen();
          }}
          aria-label="Quick open"
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Always shown: it is the way into the AI agents panel. What it can do right now is in the tooltip. */}
      <Tooltip title={assistantTooltip(assistantStatus, assistantOpen, hasLab)} arrow>
        <span>
          <IconButton
            size="small"
            onClick={onToggleAssistant}
            disabled={assistantStatus === "absent"}
            color={assistantOpen ? "warning" : "default"}
            aria-label={assistantOpen ? "Close AI agents panel" : "Open AI agents panel"}
            sx={assistantStatus === "absent" ? undefined : { opacity: assistantStatus === "connecting" ? 0.6 : 1, "&:hover": { opacity: 1 } }}
          >
            <NetlabMascot size={20} state={assistantOpen ? "idle" : "sleeping"} />
          </IconButton>
        </span>
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
