import { useState } from "react";
import { Divider, IconButton, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";

import { postLinkCommand } from "../../../api/linkCommands";
import type { LinkTraffic } from "./linkTraffic";

type Impairment = { delay?: string; loss?: string; rate?: string };

const PRESETS: Array<{ label: string; hint: string; fields: Impairment }> = [
  { label: "Add 100 ms delay", hint: "each direction", fields: { delay: "100ms" } },
  { label: "Drop 5 % of packets", hint: "each direction", fields: { loss: "5" } },
  { label: "Cap at 1 Mb/s", hint: "each direction", fields: { rate: "1000" } },
  { label: "Clear impairments", hint: "back to a clean link", fields: {} },
];

/** One-click faults for a live link: pull the cable, or apply a common netem
 * preset to both ends (the Link Impairments form on the link's context menu
 * takes arbitrary values). */
export function LinkFaultMenu({ sessionId, link, onResult }: {
  sessionId: string;
  link: LinkTraffic;
  onResult: (message: string, severity: "success" | "error") => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const ends = [link.source, link.target].filter((end) => end.stats);
  const name = `${link.source.node}:${link.source.iface} ↔ ${link.target.node}:${link.target.iface}`;

  const run = async (label: string, requests: Array<[string, Record<string, unknown>]>) => {
    setAnchor(null);
    const errors = (await Promise.all(requests.map(([path, body]) => postLinkCommand(path, { sessionId, ...body })))).filter(Boolean);
    if (errors.length === requests.length) onResult(`${label} on ${name} failed — ${errors[0]}`, "error");
    else onResult(`${label}: ${name}`, "success");
  };

  const setState = (up: boolean) => run(up ? "Brought up" : "Taken down",
    (up ? ends : ends.slice(0, 1)).map((end) => ["link-state", { node: end.node, interface: end.iface, up }]));

  const impair = (label: string, fields: Impairment) => run(label,
    ends.map((end) => ["link-impairment", { node: end.node, interface: end.iface, ...fields }]));

  return (
    <>
      <Tooltip title="Inject a fault">
        <IconButton size="small" aria-label={`Inject a fault on ${name}`} onClick={(event) => setAnchor(event.currentTarget)} sx={{ width: 22, height: 22 }}>
          <BoltIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {link.down
          ? <MenuItem onClick={() => void setState(true)}><ListItemText primary="Bring link up" /></MenuItem>
          : <MenuItem onClick={() => void setState(false)}><ListItemText primary="Take link down" secondary="like pulling the cable" /></MenuItem>}
        <Divider />
        {PRESETS.map((preset) => (
          <MenuItem key={preset.label} onClick={() => void impair(preset.label, preset.fields)}>
            <ListItemText primary={preset.label} secondary={preset.hint} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
