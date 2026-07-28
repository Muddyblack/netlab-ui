import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LightModeIcon from "@mui/icons-material/LightMode";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";

import { api, HttpError, type AssistantProvider, type HealthStatus, type NetlabEnvironment } from "../../api/client";
import type { WorkspaceEntry } from "../../lifecycle/types";
import type { AppThemeMode } from "../../theme";
import { FolderBrowserDialog } from "./FolderBrowserDialog";
import { NetlabAboutContent, RuntimeInfo } from "../NetlabAboutModal";
import { ProviderSettingsPanel } from "../../panels/assistant/ProviderSettingsDialog";

export type SettingsTab = "general" | "workspaces" | "environment" | "assistant" | "about";

const TAB_INDEX_MAP: Record<SettingsTab, number> = {
  general: 0,
  workspaces: 1,
  environment: 2,
  assistant: 3,
  about: 4
};

const TEXT_SECONDARY = "text.secondary";

function cleanVersion(value?: string | null): string {
  if (!value) return "not found";
  return value.replace(/^netlab version\s+/i, "").trim();
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography variant="body2" color={TEXT_SECONDARY}>{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: "monospace", textAlign: "right", overflowWrap: "anywhere" }}>
        {value || "—"}
      </Typography>
    </Stack>
  );
}

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

  // Workspaces tab state
  const [newPath, setNewPath] = useState("");
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  // Environment tab state
  const [environment, setEnvironment] = useState<NetlabEnvironment | null>(null);
  const [envPath, setEnvPath] = useState("");
  const [envLoading, setEnvLoading] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setActiveTab(TAB_INDEX_MAP[initialTab] ?? 0);
    }
  }, [open, initialTab]);

  const loadEnvironment = useCallback(async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const next = await api.getNetlabEnvironment();
      setEnvironment(next);
      setEnvPath(next.configured || "");
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnvLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && activeTab === 2) {
      void loadEnvironment();
    }
  }, [open, activeTab, loadEnvironment]);

  // Workspaces handlers
  const runWsGuarded = async (fn: () => Promise<void>) => {
    setWsLoading(true);
    setWsError(null);
    try {
      await fn();
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    } finally {
      setWsLoading(false);
    }
  };

  const handleAddWs = async () => {
    const path = newPath.trim();
    if (!path) return;
    await runWsGuarded(async () => {
      await onAddWorkspace(path);
      setNewPath("");
    });
  };

  const handleRemoveWs = (path: string) => runWsGuarded(() => onRemoveWorkspace(path));

  // Environment handlers
  const saveEnvironment = async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const next = await api.setNetlabPath(envPath.trim() || null);
      setEnvironment(next);
      setEnvPath(next.configured || "");
      onEnvironmentChanged();
    } catch (err) {
      if (err instanceof HttpError) {
        try {
          const body = JSON.parse(err.message.slice(err.message.indexOf("{")));
          setEnvError(body.detail || err.message);
        } catch {
          setEnvError(err.message);
        }
      } else {
        setEnvError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setEnvLoading(false);
    }
  };

  let notificationText = "System notifications for netlab background jobs";
  if (notificationPermission === "denied") {
    notificationText = "Notifications blocked by browser settings";
  } else if (notificationsEnabled) {
    notificationText = "Desktop notifications are active";
  }

  return (
    <>
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
          {/* TAB 0: GENERAL (Theme & Notifications) */}
          {activeTab === 0 && (
            <Stack spacing={3.5}>
              <Box>
                <Typography variant="subtitle2" fontWeight={650} gutterBottom>
                  Appearance Theme
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
                  Choose your preferred color scheme for netlab GUI.
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Card
                    variant={themeMode === "dark" ? "elevation" : "outlined"}
                    elevation={themeMode === "dark" ? 4 : 0}
                    sx={{
                      flex: 1,
                      border: themeMode === "dark" ? 2 : 1,
                      borderColor: themeMode === "dark" ? "primary.main" : "divider"
                    }}
                  >
                    <CardActionArea onClick={themeMode !== "dark" ? onToggleTheme : undefined} sx={{ p: 2 }}>
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Box sx={{ color: themeMode === "dark" ? "primary.main" : "text.secondary" }}>
                          <DarkModeIcon />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" fontWeight={600}>Dark Mode</Typography>
                          <Typography variant="caption" color="text.secondary">Sleek, dark contrast canvas</Typography>
                        </Box>
                        {themeMode === "dark" && <Chip size="small" color="primary" label="Active" />}
                      </Stack>
                    </CardActionArea>
                  </Card>

                  <Card
                    variant={themeMode === "light" ? "elevation" : "outlined"}
                    elevation={themeMode === "light" ? 4 : 0}
                    sx={{
                      flex: 1,
                      border: themeMode === "light" ? 2 : 1,
                      borderColor: themeMode === "light" ? "primary.main" : "divider"
                    }}
                  >
                    <CardActionArea onClick={themeMode !== "light" ? onToggleTheme : undefined} sx={{ p: 2 }}>
                      <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Box sx={{ color: themeMode === "light" ? "primary.main" : "text.secondary" }}>
                          <LightModeIcon />
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" fontWeight={600}>Light Mode</Typography>
                          <Typography variant="caption" color="text.secondary">Clean high-contrast theme</Typography>
                        </Box>
                        {themeMode === "light" && <Chip size="small" color="primary" label="Active" />}
                      </Stack>
                    </CardActionArea>
                  </Card>
                </Stack>
              </Box>

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
          )}

          {/* TAB 1: WORKSPACES */}
          {activeTab === 1 && (
            <Stack spacing={2.5}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle2" fontWeight={650}>Workspace folders</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Netlab automatically discovers topology YAML files inside these directories.
                  </Typography>
                </Box>
                <Chip size="small" variant="outlined" label={`${workspaces.length} ${workspaces.length === 1 ? "folder" : "folders"}`} />
              </Stack>

              {wsError && <Alert severity="error" onClose={() => setWsError(null)}>{wsError}</Alert>}

              {workspaces.length === 0 ? (
                <Box sx={{ py: 3, textAlign: "center", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1.5 }}>
                  <FolderOutlinedIcon color="action" sx={{ fontSize: 36, mb: 0.5 }} />
                  <Typography variant="body2" color="text.secondary">No workspace folders added yet.</Typography>
                </Box>
              ) : (
                <Stack spacing={1}>
                  {workspaces.map((ws) => {
                    const wsName = ws.path.split("/").filter(Boolean).pop() || ws.path;
                    return (
                      <Card key={ws.path} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                            <FolderOpenIcon color="primary" fontSize="small" />
                            <Box sx={{ minWidth: 0 }}>
                              <Stack direction="row" alignItems="center" spacing={1}>
                                <Typography variant="body2" fontWeight={600} noWrap>{wsName}</Typography>
                                {ws.labCount !== undefined && (
                                  <Chip size="small" variant="outlined" label={`${ws.labCount} labs`} sx={{ height: 18, fontSize: "0.7rem" }} />
                                )}
                              </Stack>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }} noWrap display="block">
                                {ws.path}
                              </Typography>
                            </Box>
                          </Stack>
                          <Tooltip title="Remove workspace">
                            <IconButton size="small" color="error" onClick={() => handleRemoveWs(ws.path)} disabled={wsLoading}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Card>
                    );
                  })}
                </Stack>
              )}

              <Divider />

              <Box>
                <Typography variant="subtitle2" fontWeight={650} gutterBottom>
                  Add workspace folder
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="/path/to/my/netlab-labs"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleAddWs(); }}
                    disabled={wsLoading}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <FolderOutlinedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      )
                    }}
                  />
                  <Button variant="outlined" onClick={() => setBrowseOpen(true)} disabled={wsLoading} sx={{ whiteSpace: "nowrap" }}>
                    Browse...
                  </Button>
                  <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddWs} disabled={wsLoading || !newPath.trim()}>
                    Add
                  </Button>
                </Stack>
              </Box>
            </Stack>
          )}

          {/* TAB 2: ENVIRONMENT */}
          {activeTab === 2 && (
            <Stack spacing={2.5}>
              {envError && <Alert severity="error">{envError}</Alert>}

              <Box>
                <Typography variant="subtitle2" fontWeight={650} gutterBottom>
                  Netlab Executable Location
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  netlab and Ansible are not bundled with the UI backend. Select the netlab executable
                  you already use, including one installed by pipx or in another virtual environment.
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Auto-detect netlab in PATH"
                    value={envPath}
                    onChange={(e) => setEnvPath(e.target.value)}
                    disabled={envLoading}
                    helperText="Leave empty to use automatic PATH resolution"
                  />
                  <Button variant="contained" onClick={saveEnvironment} disabled={envLoading}>
                    Save
                  </Button>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" fontWeight={650} gutterBottom>
                  Resolved Environment Details
                </Typography>
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.25}>
                    <InfoRow label="Netlab executable" value={environment?.binPath || environment?.command} />
                    <InfoRow label="Netlab version" value={cleanVersion(environment?.netlabVersion)} />
                    <InfoRow label="Resolution source" value={environment?.source} />
                    <InfoRow label="Target Python" value={environment?.targetPython} />
                    <InfoRow label="Netlab config path" value={environment?.configPath} />
                  </Stack>
                </Card>
              </Box>

              <Divider />

              <RuntimeInfo health={health} />
            </Stack>
          )}

          {/* TAB 4: ABOUT */}
          {activeTab === 4 && (
            <NetlabAboutContent />
          )}
        </DialogContent>
        )}

        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={onClose} variant="contained">
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <FolderBrowserDialog
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onChoose={async (path) => {
          setNewPath(path);
          setBrowseOpen(false);
        }}
      />
    </>
  );
}
