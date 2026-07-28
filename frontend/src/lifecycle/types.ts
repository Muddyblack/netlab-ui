import { NetlabBasicTab } from "../components/node-editor/NetlabBasicTab";
import { NetlabConfigTab } from "../components/node-editor/NetlabConfigTab";
import { NetlabAdvancedTab } from "../components/node-editor/NetlabAdvancedTab";
import type { HealthStatus, LabFileEntry } from "../api/client";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export const netlabNodeEditorTabs = [
  { id: "basic", label: "Basic", component: NetlabBasicTab },
  { id: "config", label: "Configuration", component: NetlabConfigTab },
  { id: "advanced", label: "Advanced", component: NetlabAdvancedTab }
];

export interface OpenLabTab {
  kind: "topology";
  id: string;
  title: string;
  subtitle: string;
  topologyRef: LabFileEntry["topologyRef"];
}

export interface OpenFileTab {
  kind: "file";
  id: string;
  title: string;
  subtitle: string;
  path: string;
  endpointId: string;
  content: string;
  originalContent: string;
  saving: boolean;
  error?: string;
  /**
   * The file changed on disk while this tab held unsaved edits, so we did not
   * clobber the editor. Holds the newer disk content the user can opt into via
   * a reload affordance; cleared once reloaded or once edits are saved away.
   */
  staleOnDisk?: boolean;
  diskContent?: string;
}

export type OpenTab = OpenLabTab | OpenFileTab;

export type WorkspaceEntry = { path: string; exists: boolean; labCount?: number };

export type StartupState =
  | { status: "checking"; health: null; error: null }
  | { status: "ready"; health: HealthStatus; error: null }
  | { status: "blocked"; health: HealthStatus | null; error: string };

export type RuntimeSnackbarState = {
  open: boolean;
  message: string;
  severity: "info" | "success" | "warning" | "error";
};

export const defaultRuntimeSnackbar: RuntimeSnackbarState = {
  open: false,
  message: "",
  severity: "info"
};

