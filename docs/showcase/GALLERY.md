# netlab-ui showcase

Screenshots and videos generated from the running app by [`run.sh`](run.sh). See [README](README.md) for how to regenerate or add a feature.

<table>
<tr>
<td width="50%" valign="top">
<a href="#showcase-canvas">
<img src="media/canvas/new-link-dark.webp" alt="A new s1–s2 link drawn on the canvas" />
</a>
<p><b>Draw labs on a canvas</b><br />Open a netlab topology as a diagram and edit it there — nodes, links and netlab's own interface names.</p>
</td>
<td width="50%" valign="top">
<a href="#showcase-deploy">
<img src="media/deploy/progress-dark.webp" alt="netlab up running, with its live output" />
</a>
<p><b>Deploy with live progress</b><br />One click on Deploy, then watch nodes come up as containerlab starts them and Ansible configures them.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="#showcase-command-palette">
<img src="media/command-palette/spotlight-dark.webp" alt="Canvas spotlight on the spine group" />
</a>
<p><b>Everything one keystroke away</b><br />Ctrl+P finds labs, nodes, IP addresses, AS numbers and actions — and lights up what it found on the canvas.</p>
</td>
<td width="50%" valign="top">
<a href="#showcase-node-editor">
<img src="media/node-editor/editor-dark.webp" alt="The node editor next to the canvas" />
</a>
<p><b>Edit nodes the netlab way</b><br />Device, modules, custom configs and a preview of the exact configuration netlab generates.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="#showcase-shell">
<img src="media/shell/vtysh-dark.webp" alt="A web shell on s1 showing OSPF neighbors and the BGP summary" />
</a>
<p><b>A shell on every node</b><br />Terminals in the browser — the device CLI or Linux shell netlab connect would give you.</p>
</td>
<td width="50%" valign="top">
<a href="#showcase-run-on-nodes">
<img src="media/run-on-nodes/focused-dark.webp" alt="The current Run on nodes panel with s1's output expanded" />
</a>
<p><b>One command, every node</b><br />Send a command to a group of nodes and read every answer, one collapsible section per node. show commands go to each device's CLI.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="#showcase-traffic">
<img src="media/traffic/lens-dark.webp" alt="Traffic lens with per-link rates on the running fabric" />
</a>
<p><b>Live traffic on the canvas</b><br />Links show their load as it happens; the traffic lens charts rates, drops and errors per link.</p>
</td>
<td width="50%" valign="top">
<a href="#showcase-link-faults">
<img src="media/link-faults/link-down-dark.webp" alt="Link s1–l2 down, flagged by the traffic lens" />
</a>
<p><b>Break things on purpose</b><br />Take a link down or add delay and loss from its menu — then watch the routing protocols react.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="#showcase-config-drift">
<img src="media/config-drift/diff-dark.webp" alt="Running-config drift: l1 changed since the snapshot, with its diff" />
</a>
<p><b>See what changed on the devices</b><br />Snapshot every node's running config, change things by hand, and get a per-device diff of exactly what moved.</p>
</td>
<td width="50%" valign="top">
<a href="#showcase-reports">
<img src="media/reports/gallery-dark.webp" alt="The report gallery over the lab" />
</a>
<p><b>netlab reports, interactive</b><br />Addressing, BGP, OSPF and wiring reports as searchable tables, rendered HTML or text — download any format.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="#showcase-ai-agents">
<img src="media/ai-agents/proposal-dark.webp" alt="An agent's proposed topology change, shown as a diff to apply or reject" />
</a>
<p><b>Bring your own AI agent</b><br />Claude Code, Codex, Gemini CLI or any MCP tool, connected to the lab. It proposes changes; you review the diff.</p>
</td>
</tr>
</table>

<details id="showcase-canvas">
<summary><b>Draw labs on a canvas</b> — Open a netlab topology as a diagram and edit it there — nodes, links and netlab's own interface names.</summary>

<img src="media/canvas/overview-dark.webp" alt="The fabric lab on the canvas with the explorer and palette" width="900" />

<img src="media/canvas/new-link-dark.webp" alt="A new s1–s2 link drawn on the canvas" width="900" />

<img src="media/canvas/preview.webp" alt="Draw labs on a canvas (animated)" width="900" />

</details>

<details id="showcase-deploy">
<summary><b>Deploy with live progress</b> — One click on Deploy, then watch nodes come up as containerlab starts them and Ansible configures them.</summary>

<img src="media/deploy/progress-dark.webp" alt="netlab up running, with its live output" width="900" />

<img src="media/deploy/completed-dark.webp" alt="netlab up finished: every node configured" width="900" />

<img src="media/deploy/running-dark.webp" alt="The fabric lab running" width="900" />

<img src="media/deploy/preview.webp" alt="Deploy with live progress (animated)" width="900" />

</details>

<details id="showcase-command-palette">
<summary><b>Everything one keystroke away</b> — Ctrl+P finds labs, nodes, IP addresses, AS numbers and actions — and lights up what it found on the canvas.</summary>

<img src="media/command-palette/palette-dark.webp" alt="The command palette finding the node that owns 10.0.0.3" width="900" />

<img src="media/command-palette/spotlight-dark.webp" alt="Canvas spotlight on the spine group" width="900" />

<img src="media/command-palette/preview.webp" alt="Everything one keystroke away (animated)" width="900" />

</details>

<details id="showcase-node-editor">
<summary><b>Edit nodes the netlab way</b> — Device, modules, custom configs and a preview of the exact configuration netlab generates.</summary>

<img src="media/node-editor/editor-dark.webp" alt="The node editor next to the canvas" width="900" />

<img src="media/node-editor/configuration-dark.webp" alt="Node editor with netlab's generated FRR configuration" width="900" />

<img src="media/node-editor/preview.webp" alt="Edit nodes the netlab way (animated)" width="900" />

</details>

<details id="showcase-shell">
<summary><b>A shell on every node</b> — Terminals in the browser — the device CLI or Linux shell netlab connect would give you.</summary>

<img src="media/shell/vtysh-dark.webp" alt="A web shell on s1 showing OSPF neighbors and the BGP summary" width="900" />

<img src="media/shell/preview.webp" alt="A shell on every node (animated)" width="900" />

</details>

<details id="showcase-run-on-nodes">
<summary><b>One command, every node</b> — Send a command to a group of nodes and read every answer, one collapsible section per node. show commands go to each device's CLI.</summary>

<img src="media/run-on-nodes/results-dark.webp" alt="OSPF neighbors from all five routers in collapsible output sections" width="900" />

<img src="media/run-on-nodes/focused-dark.webp" alt="The current Run on nodes panel with s1's output expanded" width="900" />

<img src="media/run-on-nodes/preview.webp" alt="One command, every node (animated)" width="900" />

</details>

<details id="showcase-traffic">
<summary><b>Live traffic on the canvas</b> — Links show their load as it happens; the traffic lens charts rates, drops and errors per link.</summary>

<img src="media/traffic/lens-dark.webp" alt="Traffic lens with per-link rates on the running fabric" width="900" />

<img src="media/traffic/preview.webp" alt="Live traffic on the canvas (animated)" width="900" />

</details>

<details id="showcase-link-faults">
<summary><b>Break things on purpose</b> — Take a link down or add delay and loss from its menu — then watch the routing protocols react.</summary>

<img src="media/link-faults/menu-dark.webp" alt="Link menu with fault injection" width="900" />

<img src="media/link-faults/link-down-dark.webp" alt="Link s1–l2 down, flagged by the traffic lens" width="900" />

<img src="media/link-faults/preview.webp" alt="Break things on purpose (animated)" width="900" />

</details>

<details id="showcase-config-drift">
<summary><b>See what changed on the devices</b> — Snapshot every node's running config, change things by hand, and get a per-device diff of exactly what moved.</summary>

<img src="media/config-drift/diff-dark.webp" alt="Running-config drift: l1 changed since the snapshot, with its diff" width="900" />

<img src="media/config-drift/preview.webp" alt="See what changed on the devices (animated)" width="900" />

</details>

<details id="showcase-reports">
<summary><b>netlab reports, interactive</b> — Addressing, BGP, OSPF and wiring reports as searchable tables, rendered HTML or text — download any format.</summary>

<img src="media/reports/gallery-dark.webp" alt="The report gallery over the lab" width="900" />

<img src="media/reports/addressing-dark.webp" alt="Addressing report as a table linked to the canvas" width="900" />

<img src="media/reports/ospf-dark.webp" alt="OSPF areas report rendered from netlab's HTML" width="900" />

<img src="media/reports/preview.webp" alt="netlab reports, interactive (animated)" width="900" />

</details>

<details id="showcase-ai-agents">
<summary><b>Bring your own AI agent</b> — Claude Code, Codex, Gemini CLI or any MCP tool, connected to the lab. It proposes changes; you review the diff.</summary>

<img src="media/ai-agents/panel-dark.webp" alt="The AI agents panel: start Claude Code or Codex, or connect another tool" width="900" />

<img src="media/ai-agents/proposal-dark.webp" alt="An agent's proposed topology change, shown as a diff to apply or reject" width="900" />

<img src="media/ai-agents/preview.webp" alt="Bring your own AI agent (animated)" width="900" />

</details>

<sub>Generated by <code>docs/showcase/run.sh</code> on 2026-09-28 — rerun it after UI changes.</sub>
