import { NetlabBasicTab } from "../components/node-editor/NetlabBasicTab";
import { NetlabConfigTab } from "../components/node-editor/NetlabConfigTab";
import { NetlabAdvancedTab } from "../components/node-editor/NetlabAdvancedTab";
import { NetlabModulesTab } from "../components/node-editor/NetlabModulesTab";
import { withNetlabAttrs } from "../components/node-editor/NetlabAttrsTab";

// Every tab edits netlab attributes clab-ui's own form neither loads nor
// saves; withNetlabAttrs supplies both directions.
export const netlabNodeEditorTabs = [
  { id: "basic", label: "Basic", component: withNetlabAttrs(NetlabBasicTab) },
  { id: "components", label: "Modules", component: withNetlabAttrs(NetlabModulesTab) },
  { id: "config", label: "Configuration", component: withNetlabAttrs(NetlabConfigTab) },
  { id: "advanced", label: "Advanced", component: withNetlabAttrs(NetlabAdvancedTab) }
];
