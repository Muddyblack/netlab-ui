import type { ReactElement } from "react";
import { Divider, ListItemIcon, ListItemText, MenuItem, Tooltip } from "@mui/material";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import TuneIcon from "@mui/icons-material/Tune";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import SaveAltIcon from "@mui/icons-material/SaveAlt";

interface Props {
  sessionId: string;
  /** Whether this lab's containers are currently running. Actions that operate
   * on live nodes (initial, collect, validate) are disabled when false. */
  isRunning: boolean;
  /** Whether the topology defines any `validate:` tests. null = unknown (lens
   * bundle not loaded yet) — treated as "don't disable on this basis". */
  hasTests: boolean | null;
  closeMenu: () => void;
  onInitial: () => void;
  onCreate: () => void;
  onRestart: () => void;
  onValidate: () => void;
  onCollect: () => void;
}

/** Wrap a disabled MenuItem so its reason still shows on hover (a disabled
 * button swallows native title tooltips, so MUI's Tooltip needs a live span). */
function MaybeTooltip({ reason, children }: { reason: string | null; children: ReactElement }) {
  if (!reason) return children;
  return (
    <Tooltip title={reason} placement="left">
      <span>{children}</span>
    </Tooltip>
  );
}

export function NetlabDeployMenuItems({ isRunning, hasTests, closeMenu, onInitial, onCreate, onRestart, onValidate, onCollect }: Props) {
  const run = (fn: () => void) => { closeMenu(); fn(); };

  // "initial", "collect" and "validate" act on live nodes; "create" is offline
  // file generation and "restart" (re)deploys, so both stay enabled regardless.
  const notRunningReason = isRunning ? null : "Deploy the lab first — this runs against live nodes";
  const validateReason = notRunningReason ?? (hasTests === false ? "No validate: tests defined in this topology" : null);

  return [
    <MaybeTooltip key="initial" reason={notRunningReason}>
      <MenuItem onClick={() => run(onInitial)} disabled={!isRunning}>
        <ListItemIcon><RocketLaunchIcon fontSize="small" color={isRunning ? "success" : "disabled"} /></ListItemIcon>
        <ListItemText>Initial (deploy Ansible configs)</ListItemText>
      </MenuItem>
    </MaybeTooltip>,
    <MenuItem key="create" onClick={() => run(onCreate)}>
      <ListItemIcon><TuneIcon fontSize="small" color="success" /></ListItemIcon>
      <ListItemText>Create (generate config files)</ListItemText>
    </MenuItem>,
    <MenuItem key="restart" onClick={() => run(onRestart)}>
      <ListItemIcon><RestartAltIcon fontSize="small" color="warning" /></ListItemIcon>
      <ListItemText>Restart</ListItemText>
    </MenuItem>,
    <Divider key="div1" />,
    <MaybeTooltip key="validate" reason={validateReason}>
      <MenuItem onClick={() => run(onValidate)} disabled={Boolean(validateReason)}>
        <ListItemIcon><FactCheckIcon fontSize="small" color={validateReason ? "disabled" : "info"} /></ListItemIcon>
        <ListItemText>Validate (run tests)</ListItemText>
      </MenuItem>
    </MaybeTooltip>,
    <MaybeTooltip key="collect" reason={notRunningReason}>
      <MenuItem onClick={() => run(onCollect)} disabled={!isRunning}>
        <ListItemIcon><SaveAltIcon fontSize="small" color={isRunning ? "info" : "disabled"} /></ListItemIcon>
        <ListItemText>Collect (gather device configs)</ListItemText>
      </MenuItem>
    </MaybeTooltip>
  ];
}
