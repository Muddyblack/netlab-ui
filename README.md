<p align="center">
  <img src="frontend/public/netlabxclab-netlab-ui-loop.svg" alt="Netlab x clab-ui Logo" width="480" />
</p>

<p align="center">
  <a href="https://github.com/Muddyblack/netlab-ui/releases/latest"><img src="https://img.shields.io/github/v/release/Muddyblack/netlab-ui?style=for-the-badge&labelColor=182431&logoColor=white&color=ff9f01&logo=github&label=release" alt="Latest release" /></a>
  <a href="https://github.com/Muddyblack/netlab-ui/releases"><img src="https://img.shields.io/github/downloads/Muddyblack/netlab-ui/total?style=for-the-badge&labelColor=182431&logoColor=white&color=315b75&logo=download&label=release%20downloads" alt="GitHub Release asset downloads" /></a>
  <a href="https://github.com/Muddyblack/netlab-ui/pkgs/container/netlab-ui"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2FMuddyblack%2Fnetlab-ui%2Fnetlab-ui&query=%24.downloadCountRaw&label=container%20pulls&style=for-the-badge&labelColor=182431&logoColor=white&color=315b75&logo=docker" alt="GHCR container pulls" /></a>
  <a href="docs/features.md"><img src="https://img.shields.io/badge/docs-read-ff9f01?style=for-the-badge&labelColor=182431&logoColor=white&logo=readthedocs" alt="Docs" /></a>
  <a href="https://github.com/Muddyblack/netlab-ui/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Muddyblack/netlab-ui/ci.yml?style=for-the-badge&labelColor=182431&logoColor=white&logo=githubactions&label=ci" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Muddyblack/netlab-ui?style=for-the-badge&labelColor=182431&logoColor=white&color=315b75&logo=apache&label=license" alt="License" /></a>
</p>

---

> _"I always start stuff although I tell myself I don't have time for it... and yet, here we are."_

**netlab-ui** is a web interface for [**netlab**](https://netlab.tools/) ([ipspace/netlab](https://github.com/ipspace/netlab)). Build and edit network lab topologies visually, work with netlab YAML, and deploy labs from your browser. It supports containerlab containers, libvirt virtual machines, and external devices, with [features depending on the provider](docs/features.md#providers-containerlab-libvirt-vms-external-devices).

Use the visual topology editor to add nodes and links, configure netlab modules, and inspect your lab. Deploy and destroy labs, open device shells, run commands across nodes, and explore live traffic and network reports from the same UI.

The canvas is powered by [**clab-ui**](https://github.com/srl-labs/containerlab-app), with netlab-specific editors and lifecycle actions implemented in this project.

**[Try the UI preview](https://muddyblack.github.io/netlab-ui/)** · **[Quick start](#quick-start)** · **[Features and provider support](docs/features.md)**

<p align="center">
  <a href="docs/showcase/GALLERY.md#showcase-traffic"><img src="docs/showcase/media/traffic/lens-dark.webp" alt="netlab-ui: a running leaf/spine lab with live traffic on every link" width="900" /></a>
</p>

## In action

<!-- showcase:start -->
**▶ [Watch the tour](docs/showcase/media/netlab-ui-showcase.mp4)**: every recorded feature in one video.

<table>
<tr>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-canvas">
<img src="docs/showcase/media/canvas/new-link-dark.webp" alt="A new s1–s2 link drawn on the canvas" />
</a>
<p><b>Draw labs on a canvas</b><br />Open a netlab topology as a diagram and edit it there — nodes, links and netlab's own interface names.</p>
</td>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-deploy">
<img src="docs/showcase/media/deploy/progress-dark.webp" alt="netlab up running, with its live output" />
</a>
<p><b>Deploy with live progress</b><br />One click on Deploy, then watch nodes come up as containerlab starts them and Ansible configures them.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-command-palette">
<img src="docs/showcase/media/command-palette/spotlight-dark.webp" alt="Canvas spotlight on the spine group" />
</a>
<p><b>Everything one keystroke away</b><br />Ctrl+P finds labs, nodes, IP addresses, AS numbers and actions — and lights up what it found on the canvas.</p>
</td>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-node-editor">
<img src="docs/showcase/media/node-editor/editor-dark.webp" alt="The node editor next to the canvas" />
</a>
<p><b>Edit nodes the netlab way</b><br />Device, modules, custom configs and a preview of the exact configuration netlab generates.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-shell">
<img src="docs/showcase/media/shell/vtysh-dark.webp" alt="A web shell on s1 showing OSPF neighbors and the BGP summary" />
</a>
<p><b>A shell on every node</b><br />Terminals in the browser — the device CLI or Linux shell netlab connect would give you.</p>
</td>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-run-on-nodes">
<img src="docs/showcase/media/run-on-nodes/focused-dark.webp" alt="The current Run on nodes panel with s1's output expanded" />
</a>
<p><b>One command, every node</b><br />Send a command to a group of nodes and read every answer, one collapsible section per node. show commands go to each device's CLI.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-link-faults">
<img src="docs/showcase/media/link-faults/link-down-dark.webp" alt="Link s1–l2 down, flagged by the traffic lens" />
</a>
<p><b>Break things on purpose</b><br />Take a link down or add delay and loss from its menu — then watch the routing protocols react.</p>
</td>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-config-drift">
<img src="docs/showcase/media/config-drift/diff-dark.webp" alt="Running-config drift: l1 changed since the snapshot, with its diff" />
</a>
<p><b>See what changed on the devices</b><br />Snapshot every node's running config, change things by hand, and get a per-device diff of exactly what moved.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-reports">
<img src="docs/showcase/media/reports/gallery-dark.webp" alt="The report gallery over the lab" />
</a>
<p><b>netlab reports, interactive</b><br />Addressing, BGP, OSPF and wiring reports as searchable tables, rendered HTML or text — download any format.</p>
</td>
<td width="50%" valign="top">
<a href="docs/showcase/GALLERY.md#showcase-ai-agents">
<img src="docs/showcase/media/ai-agents/proposal-dark.webp" alt="An agent's proposed topology change, shown as a diff to apply or reject" />
</a>
<p><b>Bring your own AI agent</b><br />Claude Code, Codex, Gemini CLI or any MCP tool, connected to the lab. It proposes changes; you review the diff.</p>
</td>
</tr>
</table>

<!-- showcase:end -->

## Quick start

Everything included (netlab, Ansible, containerlab); the host only needs Docker:

```bash
docker compose up -d          # uses docker-compose.yml; labs live in ./labs
```

Open `http://localhost:8000`. The flags that matter, the UI-only image, multi-user setups and building it yourself are in [docs/container.md](docs/container.md). To run from source instead, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| | |
| --- | --- |
| [Features](docs/features.md) | Shortcuts, run on nodes, search, running configs, exercises, live traffic, faults, packet capture, providers, reports |
| [Monitoring](monitoring/README.md) | The netlab `monitoring` plugin: metrics, routing-protocol state and Grafana dashboards for any lab and vendor — also usable without the UI |
| [AI agents](docs/ai-agents.md) | Start Claude Code, Codex or Gemini CLI connected to your lab, or connect any MCP tool; review what it proposes |
| [Running as a container](docs/container.md) | Images, required flags, several users on one server |
| [Desktop app](docs/desktop.md) | The Electron shell around the same UI |
| [Architecture](docs/architecture.md) | How netlab-ui builds on clab-ui and netlab |
| [netlab docs: netlab-ui](https://netlab.tools/extool/netlab-ui/) | netlab-ui as a netlab external tool (`tools: [netlab-ui]`); the page goes live once [ipspace/netlab#3913](https://github.com/ipspace/netlab/pull/3913) is merged |
| [Contributing](CONTRIBUTING.md) | Dev setup, checks, API types, clab-ui patches, showcase |

## Thanks

None of this exists without [ipspace/netlab](https://github.com/ipspace/netlab) and [srl-labs/containerlab-app](https://github.com/srl-labs/containerlab-app) (clab-ui) / [srl-labs/containerlab](https://github.com/srl-labs/containerlab) doing the actual hard work underneath. Big thanks to SRL Labs and Nokia for open-sourcing and maintaining tools this good ❤️
