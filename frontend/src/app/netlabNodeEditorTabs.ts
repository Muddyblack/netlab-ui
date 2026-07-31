import { NetlabBasicTab } from "../components/node-editor/NetlabBasicTab";
import { NetlabConfigTab } from "../components/node-editor/NetlabConfigTab";
import { NetlabAdvancedTab } from "../components/node-editor/NetlabAdvancedTab";
import { NetlabModulesTab } from "../components/node-editor/NetlabModulesTab";

export const netlabNodeEditorTabs = [
  { id: "basic", label: "Basic", component: NetlabBasicTab },
  { id: "components", label: "Modules", component: NetlabModulesTab },
  { id: "config", label: "Configuration", component: NetlabConfigTab },
  { id: "advanced", label: "Advanced", component: NetlabAdvancedTab }
];
