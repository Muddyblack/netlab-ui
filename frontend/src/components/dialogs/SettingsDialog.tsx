import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Tab,
  Tabs,
  Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import type { AssistantProvider, HealthStatus } from "../../api/client";
import type { WorkspaceEntry } from "../../lifecycle/types";
import type { AppThemeMode } from "../../theme";
import { NetlabAboutContent } from "../NetlabAboutModal";
import { ProviderSettingsPanel } from "../../panels/assistant/ProviderSettingsDialog";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsWorkspacesTab } from "./SettingsWorkspacesTab";
import { SettingsEnvironmentTab } from "./SettingsEnvironmentTab";

export type SettingsTab = "general" | "workspaces" | "environment" | "assistant" | "about";

const TAB_INDEX_MAP: Record<SettingsTab, number> = {
  general: 0,
  workspaces: 1,
  environment: 2,
  assistant: 3,
  about: 4
};

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;

  // General
  themeMode: AppThemeMode;
  onToggleTheme: () => void;
  notificationsSupported: boolean;
  notificationsEnabled: boolean;
  notificationPermission: NotificationPermission | "unavailable";
  onToggleNotifications: () => void;

  // Workspaces
  workspaces: WorkspaceEntry[];
  onAddWorkspace: (path: string) => Promise<void>;
  onRemoveWorkspace: (path: string) => Promise<void>;

  // Environment
  onEnvironmentChanged: () => void;

  // Assistant
  assistantProviders: AssistantProvider[];
  assistantInitialProviderId?: string;
  onAssistantChanged: () => void;

  // Health / About
  health: HealthStatus | null;
}

export function SettingsDialog({
  open,
  onClose,
  initialTab = "general",
  themeMode,
  onToggleTheme,
  notificationsSupported,
  notificationsEnabled,
  notificationPermission,
  onToggleNotifications,
  workspaces,
  onAddWorkspace,
  onRemoveWorkspace,
  onEnvironmentChanged,
  assistantProviders,
  assistantInitialProviderId,
  onAssistantChanged,
  health
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<number>(TAB_INDEX_MAP[initialTab] ?? 0);

  useEffect(() => {
    if (open) {
      setActiveTab(TAB_INDEX_MAP[initialTab] ?? 0);
    }
  }, [open, initialTab]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 2, overflow: "hidden", minHeight: 540 } } }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 2, px: 3, py: 2 }}>
        <Box
          component="img"
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="netlab-ui logo"
          sx={{ width: 42, height: 42 }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
            netlab-ui
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Visual authoring and lifecycle management for{" "}
            <Link href="https://netlab.tools/" target="_blank" rel="noopener noreferrer" underline="hover">
              netlab
            </Link>{" "}
            virtual network labs.
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label="Close settings">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <Tabs
        value={activeTab}
        onChange={(_, val: number) => setActiveTab(val)}
        sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="General" />
        <Tab label="Workspaces" />
        <Tab label="Environment" />
        <Tab label="Assistant" />
        <Tab label="About" />
      </Tabs>

      {activeTab === 3 ? (
        <Box sx={{ px: 3 }}>
          <ProviderSettingsPanel
            providers={assistantProviders}
            initialProviderId={assistantInitialProviderId}
            onChanged={onAssistantChanged}
            active={open && activeTab === 3}
          />
        </Box>
      ) : (
        <DialogContent dividers sx={{ px: 3, py: 2.5, minHeight: 380 }}>
          {activeTab === 0 && (
            <SettingsGeneralTab
              themeMode={themeMode}
              onToggleTheme={onToggleTheme}
              notificationsSupported={notificationsSupported}
              notificationsEnabled={notificationsEnabled}
              notificationPermission={notificationPermission}
              onToggleNotifications={onToggleNotifications}
            />
          )}

          {activeTab === 1 && (
            <SettingsWorkspacesTab
              workspaces={workspaces}
              onAddWorkspace={onAddWorkspace}
              onRemoveWorkspace={onRemoveWorkspace}
            />
          )}

          {activeTab === 2 && (
            <SettingsEnvironmentTab
              active={open && activeTab === 2}
              onEnvironmentChanged={onEnvironmentChanged}
              health={health}
            />
          )}

          {activeTab === 4 && <NetlabAboutContent />}
        </DialogContent>
      )}

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
