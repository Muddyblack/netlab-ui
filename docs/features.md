# Working with running labs

## Shortcuts

| Keys | Opens |
|---|---|
| **Ctrl+P** | everything: labs, nodes, actions, and search inside the lab. Context actions (run on nodes, live traffic, running configs) come first while a lab runs. |
| **Ctrl+`** | Run command on nodes (canvas selection preselected) |
| **Ctrl+I** | AI agents panel (connect your agent over MCP, review its proposals) |

## Run a command on many nodes

**Run Command on Nodes…** (right-click a deployed lab, or the stacked-cards
button in the terminal dock) opens a dock tab that sends one command to any
mix of nodes, groups and `all`, in parallel:

- **Auto** (the default) sends `show …` to each device's CLI (`netlab
  connect --show`: vtysh, Cli, sr_cli…) and everything else to its shell
  (`netlab exec`; pipes work); Linux hosts always get the shell. **Shell** /
  **Show** force one.
- Nodes selected on the canvas are preselected; `all` means the running nodes.
- **Quick** chips offer your last commands plus the ones that fit this lab
  (`show ip ospf neighbor` only if it runs OSPF…). One click runs one;
  Shift-click puts it in the command box to edit first.
- Answers appear side by side, and identical answers are merged
  (`r[1-3]`) so the odd node stands out. Non-zero exits and CLI error replies
  (`% Unknown command`) are flagged red.
- ↑/↓ browse the command history, and ↻ re-runs a command.
- **Save session as script** stores the commands next to the topology in
  `<topology>.netlab-ui-scripts.json`, so the script is part of the lab. The
  ⏵ scripts menu replays one; **Export transcript** downloads the session as
  Markdown.

## Find anything in a lab

**Ctrl+P** searches netlab's *transformed* topology as well as labs, nodes
and actions. That includes addresses netlab assigned from its pools and
modules a node inherits from a group.

| Type | Finds |
|---|---|
| `10.1.0.5` | the interface holding it, or whose subnet contains it |
| `10.1.0.0/16` | every address inside the prefix |
| `as 65001` | BGP AS |
| `10` | VLAN id, AS or node id |
| `module:ospf`, `vlan:`, `vrf:`, `group:`, `device:eos`, `role:` | that kind only (`module:` alone lists all modules) |

Picking a hit spotlights its nodes: everything else on the canvas is dimmed.
The spotlight bar has one chip per module, so you can switch the canvas
between "who runs OSPF / BGP / VLANs"; press Esc to show everything again.

## Running configs and what changed

**Running Configs & Changes…** (right-click a deployed lab → Inspect, or the
📜 button in the Lenses panel) shows what the devices actually run.

- A **snapshot** of every node's `show running-config` is taken automatically
  after each successful deploy, restart or `netlab initial`. You can also
  take one by hand.
- The node list shows **drift**: lines added and removed since the chosen
  snapshot. Volatile header and timestamp lines are ignored.
- A side-by-side diff compares any snapshot with the live configuration, or
  two snapshots, e.g. to see what a `netlab initial` or a hand edit changed.

Snapshots live in `<lab>/.netlab-ui/configs/<topology>/`; the newest 20 are
kept. The generated (not running) configuration per module is still in the
node editor's Config tab.

## Guided exercises

Guided tours (Lenses → ▶ tour button) are now also exercises. A step can
have:

- a **task** for the student,
- **checks**: `netlab validate` tests from the lab's `validate:` block, picked
  from a list with their descriptions,
- a **hint** that is shown after a failed check.

In presentation mode the student presses **Check my work**. Only that step's
tests run, and the step passes when all of them pass; failures show netlab's
own message and the hint. A progress bar counts passed steps; it is kept per
browser, and clicking it starts over. Everything is stored in the lab's
`<topology>.netlab-teaching.json`, so a lab and its exercise travel together
(e.g. via **Copy Lab to Workspace…**).

## Live traffic

Click a link on a deployed lab to see its traffic chart (clab-ui's link
panel). The **Traffic** lens (Lenses tab) shows every link at once: links
are coloured and thickened by load and labelled with their rate. A link
that is down turns red and dashed; one that is dropping or erroring *right
now* turns red. The panel lists all links, busiest and broken ones first.
Counters are read from the containers every 3 seconds.

## Fault injection

- Right-click a link → **Take Link Down** / **Bring Link Up**. This pulls the
  cable (`ip link set … down` in the container), so the peer loses carrier and
  routing protocols react as they would to a real failure.
- Right-click a link → **Link Impairments** sets netem delay, jitter, loss,
  rate and corruption per endpoint. The form now shows what is actually
  applied, read back from `tc`.
- In the Traffic lens, each link row has a ⚡ menu: down/up, 100 ms delay,
  5 % loss, 1 Mb/s cap, or clear (applied to both ends).

Impairments need the lab host's `sch_netem` kernel module (`sudo modprobe
sch_netem` if the UI reports that netem is missing).

## Packet capture

The Wireshark items on a link's (or node's) context menu open a capture
dialog with three ways to capture:

- **Download a pcap** of 10 s to 5 min. It captures both directions and
  keeps VLAN tags. No Edgeshark or tcpdump is needed: the backend enters the
  node's network namespace itself.
- **Live in your own Wireshark**: copy the
  `curl -sN '…/api/lab/capture/pcap?…&seconds=0' | wireshark -k -i -` command.
- **Wireshark in the browser** via Edgeshark (as before). Its web port is now
  published on the UI's own bind address (`127.0.0.1` by default), no longer
  on every interface. Set `NETLAB_APP_CAPTURE_BIND` to change it.

In a regular node shell, **⇄ Sync input** mirrors your typing into every other
shell that has sync switched on (like tmux's synchronize-panes).

## Providers: containerlab, libvirt VMs, external devices

netlab has three providers, and every lab can mix them (`provider:` on a node
overrides the lab's). The UI works with all three. A lab without containers
gets its canvas straight from netlab's transformed topology, so VMs show
netlab's real interface names (`Ethernet1`, `GigabitEthernet0/1`). Settings →
Environment has the same table as below; hover a mark there for the reason.

| Feature | containerlab | libvirt VMs | external devices |
|---|:-:|:-:|:-:|
| Draw/edit, validate, preview configs, deploy diff | ✅ | ✅ | ✅ |
| Deploy / destroy | ✅ | ✅ ¹ | ◐ configs only |
| Web shell, run on many nodes, running configs | ✅ | ✅ (SSH) | ✅ |
| Start / stop / restart / pause a node | ✅ | ✅ `virsh` | — |
| Link down / up | ✅ | ✅ `domif-setlink` | — |
| Live traffic and errors | ✅ | ◐ ² | — |
| Packet capture | ✅ | ◐ ² | — |
| Link impairment (delay, loss, rate) | ✅ | ◐ ² via `netlab tc` | — |
| Node logs | ✅ | — | — |
| Image manager | ✅ | — (Vagrant boxes) | — |

¹ Needs KVM, libvirt and Vagrant on the backend host. The container image has
none of them; run the backend natively, or use the UI-only image with a host
netlab install.
² Link state works on every VM link. Counters, capture and impairment work on
LAN links only: netlab builds point-to-point VM links as UDP tunnels with no host
interface (the same limit `netlab capture` has).

Where something isn't possible for a node, the UI says why instead of failing.

## More of netlab: tools, reports, setup

- **External tools** (Ctrl+P → *External tools*, or a lab's context menu):
  Graphite, SuzieQ, NUTS, Cisco NSO and Edgeshark from netlab's `tools:`.
  Switch one on and netlab starts it with every deploy. For a deployed lab,
  see whether it runs, open its web UI, connect to its CLI (`netlab connect
  suzieq`) or start and stop it. The commands are netlab's own.
- **Reports** (Ctrl+P → *Reports*): every netlab report as a table, rendered
  HTML or text, with download in each format netlab offers (`.md`, `.html`,
  text) and *Open* for the HTML version. The HTML is sandboxed: scripts don't
  run and it doesn't get the UI's origin.
- **Custom configs**: the node editor's *Configuration* tab lists the
  templates netlab would find for `config: [name]` (lab directory,
  `~/.netlab`, `/etc/netlab`) and warns when one has no variant for the
  node's device. *New template* creates `<name>/<device>.j2` with a commented
  starter and opens it.
- **Containerlab tarball** (a deployed lab's context menu, or Ctrl+P): `netlab
  clab tarball` downloads `clab.config.yml` plus the devices' current configs,
  to run with plain containerlab elsewhere.
- **Setup helpers** (Settings → Environment):
  - *Check my setup* runs `netlab test clab|libvirt|podman|grpc`: a real
    deploy of a tiny lab, checked and removed again. Stopping it halfway
    still tears everything down.
  - *Install software* runs `netlab install` (Ansible, containerlab, libvirt,
    GraphViz…) on the backend host. It needs root or password-less sudo.
  - *Build routing-daemon containers* runs `netlab clab build` (BIRD,
    dnsmasq…).
  - *Vagrant box recipes* show `netlab libvirt config <device>`.
