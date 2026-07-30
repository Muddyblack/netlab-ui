import { createPortal } from "react-dom";
import { IconButton, Tooltip } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { LabTabsBar } from "../LabTabsBar";
import { NetlabLinks } from "../../panels/NetlabLinks";
import type { OpenTab, RuntimeSnackbarState } from "../../lifecycle/types";

interface AppSidebarPortalsProps {
  sessionId: string | null;
  netlabLinksPaletteContainer: HTMLElement | null;
  refreshCanvas: () => void;
  addToast: (message: string, severity?: RuntimeSnackbarState["severity"]) => void;
  leftSidebarToggleContainer: HTMLElement | null;
  isLeftSidebarOpen: boolean;
  handleToggleLeftSidebar: () => void;
  tabBarContainer: HTMLElement | null;
  openTabs: OpenTab[];
  activeTabId: string | null;
  handleActivateLabTab: (id: string) => Promise<void>;
  handleCloseLab: (id: string) => Promise<void>;
}

export function AppSidebarPortals({
  sessionId,
  netlabLinksPaletteContainer,
  refreshCanvas,
  addToast,
  leftSidebarToggleContainer,
  isLeftSidebarOpen,
  handleToggleLeftSidebar,
  tabBarContainer,
  openTabs,
  activeTabId,
  handleActivateLabTab,
  handleCloseLab
}: AppSidebarPortalsProps) {
  return (
    <>
      {sessionId && netlabLinksPaletteContainer && createPortal(
        <NetlabLinks sessionId={sessionId} onChanged={refreshCanvas} onToast={addToast} />,
        netlabLinksPaletteContainer
      )}

      {leftSidebarToggleContainer && createPortal(
        <Tooltip title={isLeftSidebarOpen ? "Hide left sidebar" : "Show left sidebar"} placement="right">
          <IconButton
            size="small"
            onClick={handleToggleLeftSidebar}
            data-testid="left-sidebar-toggle"
            sx={{
              width: 20,
              height: 48,
              borderRadius: "0 4px 4px 0",
              border: 1,
              borderLeft: 0,
              borderColor: "divider",
              bgcolor: "background.paper",
              color: "text.secondary",
              p: 0,
              "&:hover": { bgcolor: "action.hover" }
            }}
          >
            {isLeftSidebarOpen
              ? <ChevronLeftIcon sx={{ fontSize: 16 }} />
              : <ChevronRightIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>,
        leftSidebarToggleContainer
      )}

      {tabBarContainer && openTabs.length > 0 && createPortal(
        <LabTabsBar
          activeTabId={activeTabId}
          tabs={openTabs.map((t) => ({ id: t.id, title: t.title, subtitle: t.subtitle, path: t.kind === "topology" ? t.topologyRef?.yamlPath : t.path, dirty: t.kind === "file" ? t.content !== t.originalContent : false }))}
          onActivate={(id) => void handleActivateLabTab(id)}
          onClose={(id) => void handleCloseLab(id)}
        />,
        tabBarContainer
      )}
    </>
  );
}
