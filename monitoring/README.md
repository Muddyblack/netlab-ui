# netlab lab monitoring

A netlab **plugin** that adds monitoring to any lab, for every device type, with nothing
installed in the devices and no change to netlab itself:

* **Every container and libvirt VM**: CPU, memory and per-interface traffic, errors, drops,
  link state and link flaps -- read on the lab host (`/proc`, cgroups, libvirt state).
* **Routing protocol state**: OSPF, IS-IS, BGP (including EVPN sessions), BFD, VXLAN VNIs (FRR) and routing-table size, chosen per device:
  FRR-based devices through the FRR daemons' own sockets, gNMI devices (SR Linux, Arista,
  Juniper) through gnmic, SNMP devices through snmp_exporter.
* **What the topology intends**: every BGP session, OSPF/IS-IS adjacency and VXLAN VNI netlab configured,
  so "defined but not up" works the same for every vendor.
* **Storage and dashboards**: VictoriaMetrics (Prometheus-compatible, light at scale) and
  Grafana with three dashboards: lab overview (a topology graph is folded at the bottom, for
  Grafana without netlab-ui), routing &
  convergence (flaps per router, OSPF neighbor states, BGP per peer, SPF, LSAs), node detail.

Every metric carries netlab names -- `node`, `ifname`, `link`, `peer_node` -- so a query or a
dashboard never needs to know which vendor or collection method produced it.

## Support level

| | |
|---|---|
| **Tested on real devices or services** | FRR (OSPF, IS-IS, BGP, BFD, routes); Nokia SR Linux over gNMI (interfaces, BGP, OSPF, IS-IS, routes, convergence counters); host metrics for any container; logs (Loki, Vector); `placement: tool` and `node`; fault tests (on FRR) |
| **Experimental** | OpenConfig gNMI (Arista cEOS, Juniper), SNMP (IOS, NX-OS), libvirt VMs (best effort, upstream is sunsetting the provider), Slack and email alert targets (a webhook target is tested), VXLAN MAC and remote-VTEP counts on a multi-VTEP fabric |

`netlab create` prints an `Experimental:` line naming the nodes of a lab that use one of these. They have
config and mapping tests, but no run against a real device yet, so expect to fix a path or a label the first
time. Details per feature are in [What is tested where](#what-is-tested-where). Vendor mappings are
written when someone has the device to test them on, not ahead of that.

![Routing and convergence dashboard during a link flap](docs/dashboard-routing.png)

![netlab-ui Monitoring dialog](docs/netlab-ui-dialog.png)

## Use it

### From the netlab CLI

```bash
ln -s /path/to/netlab-ui/monitoring/plugin/monitoring ~/.netlab/monitoring   # once
```

```yaml
# topology.yml
plugin: [ monitoring ]
```

`netlab up` writes `monitoring/` next to the topology, starts the stack after the lab and
prints the Grafana URL (`http://<host>:3000`, anonymous read-only; `admin`/`admin` to edit).
`netlab down` stops it; the metrics stay in `monitoring/data` for later comparison.

### From netlab-ui

Lab context menu or Ctrl+P → **Monitoring…** → switch it on. The UI installs the plugin in
`~/.netlab` and edits the topology for you. The dialog has three tabs:

* **Health**: nodes, BGP sessions, OSPF/IS-IS adjacencies and VXLAN VNIs up vs what the topology defines,
  what is missing, and buttons for the dashboards.
* **Fault tests**: repeatable link flaps (see below).
* **Setup**: where the stack runs, start/stop, the opt-in logs and alert notifications (webhook,
  Slack; an email target is set in the topology), and how each node is collected.

### Dashboard markers

Toggles at the top of every dashboard switch these markers on and off:

| Toggle | Default | Shows |
|---|---|---|
| **Link outages** | on | Orange band: a link taken down from netlab-ui, until it came back up |
| **Fault tests** | on | Purple band: each down period of a fault test |
| **SPF runs** | off | Blue line: when a router ran OSPF or IS-IS SPF |
| **Neighbor changes** | off | Red line: when an OSPF/IS-IS adjacency or BGP session last changed, per router and peer |

SPF and neighbor markers come from the devices' own timestamps, so they sit at the moment the
router did it, not at the next scrape. Turn them on next to a fault test to see which
routers recalculated, and how often, after a link went down and came back.

![SPF runs and neighbor changes around two fault-test cycles](docs/dashboard-markers.png)

### Fault tests (repeatable link flaps)

A fault test takes links down and up on a fixed schedule and measures every cycle:

| | |
|---|---|
| Reaction | Time from link down until a session/adjacency the topology defines went down |
| Impact | How many were down at the worst moment (and which) |
| Recovery | Time from link up until everything the topology defines was up again, from the devices' own "last changed" timestamps where they report them, otherwise sampled twice a second |

Containers are flapped with `ip link`, libvirt VMs with `virsh domif-setlink`.

> **libvirt is in maintenance mode upstream.** netlab 26.09 sunsets the Vagrant/libvirt provider
> (bug fixes only, no device integration tests, removal planned within 1-2 years; see
> [netlab#3912](https://github.com/ipspace/netlab/issues/3912)). Monitoring libvirt VMs was
> tested successfully on a real KVM host (libvirt 12.2, QEMU VMs, cgroup v2) and works today, but
> expect no new work on it. For VM-only devices netlab recommends vrnetlab containers under
> containerlab, which are monitored like any other container.

**Write them into the topology**, next to netlab's own [validation tests](https://netlab.tools/topology/validate/),
so they're versioned with the lab and give the same answer every run:

```yaml
monitoring.faults:
  core_link:
    description: Lose the r1-r2 link (OSPF, IS-IS, iBGP)
    links: [ r1-r2 ]          # link names, or ends like r1:eth1
    cycles: 3
    down: 10                  # seconds down, then up, per cycle
    up: 30
    during: [ ospf_r2 ]       # netlab validate tests while the link is down
    validate: [ ospf_r2, ibgp ]   # ... and after it comes back (true: all tests)
    expect.recovery: 5        # recovery slower than this fails the run

validate:                     # netlab's own tests, run by `netlab validate` too
  ospf_r2:
    description: r1 has a Full OSPF adjacency with r2
    wait: 20
    nodes: [ r1 ]
    plugin: ospf_neighbor(nodes.r2.ospf.router_id)
  ibgp:
    description: iBGP r1 - r2 established
    wait: 30
    nodes: [ r1 ]
    plugin: bgp_neighbor(node.bgp.neighbors,'r2')
```

The two sides complement each other: monitoring times what the control plane did,
`netlab validate` checks what the lab has to deliver (neighbors, prefixes, reachability) with
each device's own validation plugin. A run **passes** when every cycle recovered within
`expect.recovery` and every `validate` test passed afterwards; otherwise the verdict lists why.
Tests run while the link is down use `--skip-wait` (the state right then), tests after
recovery use their own `wait:`.

In netlab-ui the Fault tests tab lists the lab's fault tests with a **Run** button and their
last verdict; a quick test (any link, optionally with all `validate` tests) is there too.
Runs are saved in `monitoring/scenarios/*.json` next to the topology, and each cycle is a band
on the dashboards. API: `GET /api/lab/monitoring/faults`, `POST /api/lab/monitoring/scenarios`
(`{"sessionId": ..., "name": "core_link"}`).

![Fault tests in netlab-ui: a named test, its verdict and netlab validate results](docs/netlab-ui-fault-tests.png)

In the lab this was developed on, `core_link` recovers in 10.1 s on every cycle: FRR's OSPF
hello interval (10 s) decides it, and `netlab validate` agrees (9.6-9.8 s).

## Your own dashboards and alerts

Everything lives in the lab's `monitoring/` folder, is never overwritten by `netlab create`,
and goes live within about 10 seconds, with no restart and no change to the plugin.
`monitoring/METRICS.md` lists every metric and label (generated from the collector).

**Dashboards.** Write a short YAML spec and compile it, or drop in any Grafana JSON (Grafana:
Share > Export). They appear in Grafana's **My dashboards** folder, which is editable
(the built-in boards are read-only). Edits made in the Grafana UI are kept in `monitoring/data/grafana`.

```yaml
# board.yml
title: BGP at a glance
node_variable: true                 # adds the $node picker
rows:
  - title: Sessions
    panels:
      - { type: stat, title: Established, expr: 'sum(netlab_bgp_session_up{lab="$lab"})' }
      - type: timeseries
        title: Session state per peer
        queries:
          - { expr: 'netlab_bgp_session_up{lab="$lab",node=~"$node"}', legend: '{{node}} -> {{peer}}' }
```

```bash
python -m netlab_monitoring.spec board.yml -o monitoring/dashboards/bgp.json   # PYTHONPATH=<plugin>/lib
```

Panel types are `stat`, `timeseries` and `table`; options are `unit`, `description`, `width`
(1-24), `height`, `stack`, and `thresholds` for stats. Filter on `lab="$lab"` so the board follows
the lab picker. The compiler rejects a broken spec with a message naming the panel, and warns
about unknown `netlab_*` metrics.

The built-in dashboards are written in this same format: `plugin/monitoring/lib/netlab_monitoring/dashboards/*.yml`
(overview, routing, node detail, logs). Copy one as a starting point. Tables also take `rename`, `hide`
and `overrides` (colour a state column with `{field: State, colors: up_down}`), a board takes `macros`
(`NAME: text`, used as `@NAME@` in queries), and a row can be `collapsed`; the options are listed at the top of
`spec.py`.

**Alerts.** Put Prometheus-format rule files in `monitoring/alerts/*.yml`; [vmalert](https://docs.victoriametrics.com/victoriametrics/vmalert/)
evaluates them together with the built-in rules (BGP sessions and OSPF/IS-IS adjacencies the topology
defines but that are not up, node down, collector failing). Firing alerts are listed at
`http://<host>:8880` and stored as the `ALERTS` metric, so they can be graphed and queried like
anything else. A starter `alerts/example.yml` is created on first `netlab create`.

**From the AI assistant.** The netlab-ui MCP server has `list_metrics` (what exists, plus the spec
and rule formats), `query_metrics` (try a query first), `create_dashboard` and `create_alert_rules`.
Both create tools validate before writing and report unknown metrics, so "make me a board of BGP
prefixes per peer" or "alert when a router uses over 1.5 GiB" works without writing JSON by hand.

## Logs (opt-in)

```yaml
monitoring.logs.enabled: true      # retention: 168h by default
```

Adds Loki (storage) and Vector (collection) and a **netlab logs** dashboard in Grafana, with the
same lab and node pickers and a search box. Every line carries `lab`, `node`, `severity` and
`source`, so a log line lines up with the metrics on the other dashboards.

| Source | Needs on the device | Notes |
|---|---|---|
| **Container logs** of every containerlab node | Nothing | Docker's stdout/stderr of the node, labelled by node name |
| **Syslog** (UDP, port 1514) | Point the device at `<lab host>:1514` | The sender is matched to a node by its management address, else by the hostname in the message. Lines are stamped on arrival, because lab devices' clocks drift and syslog timestamps carry no year or zone |

**The lab host's firewall must allow UDP 1514 from the lab management network.** Devices reach the host
over the management bridge, and a default-deny host firewall (NixOS, firewalld, ufw) drops their syslog
silently: nothing shows up in Loki and nothing reports an error.

Pointing a device at the stack is device configuration, so the plugin does not do it for you:
for example `logging host <lab host> transport udp port 1514` (EOS, IOS) or
`set system syslog host <lab host> any any port 1514` (Junos). Query them in Grafana, or ask the
assistant (`query_logs`). Data is kept in `monitoring/data/loki`.

## Alert notifications (opt-in)

Without a target, firing alerts stay in vmalert (`http://<host>:8880`) and the `ALERTS` metric. To
have them delivered, add one or more targets; the plugin then starts an Alertmanager
(`http://<host>:9093`, grouped by alert, lab and node, resolved notices included):

```yaml
monitoring.alerts.notify:
  webhook: https://example.org/hooks/netlab        # Alertmanager's JSON, for scripts and chat bridges
  slack: https://hooks.slack.com/services/T000/B000/xxxx
  email: { to: ops@example.org, from: netlab@example.org, smarthost: "smtp.example.org:587", username: u, password: p }
```

This applies to the built-in rules and to your own `monitoring/alerts/*.yml`. Webhook and Slack URLs
and the SMTP password are written into `monitoring/alertmanager/alertmanager.yml`, so keep the lab
directory out of version control if they are secrets.

## Choosing which nodes are monitored

By default every node is. On a large lab, or to save CPU on the devices, pick part of it with
`monitoring.nodes`, and mark some of those as host-only with `monitoring.light`. A host-only node still
gets CPU, memory and interface counters (read on the lab host), but no protocol collection and no login to
the device. Both are lists of selectors, added up in order:

```yaml
monitoring:
  nodes:
    - leaf*                       # a glob over node names
    - re:spine[0-9]+              # a regular expression; it must match the whole node name
    - core                        # a node, or a group (groups inside groups work)
    - group:pod* | first 10       # every group matching the glob: the first 10 members of each
    - leaf* | random 5            # 5 of the matches, the same 5 every run (see seed)
    - device=srlinux              # by device, role, provider or module; the value may be a glob
    - "!leaf9*"                   # a leading ! takes the matches out again
  light: [ "*", "!leaf1*" ]       # everything host-only except leaf1*
  seed: 7                         # for random picks
```

| Selector | Takes |
|---|---|
| `r1`, `leaf*`, `re:...` | nodes by name (a plain name that is a group takes its members) |
| `group:GLOB` | the members of every group whose name matches |
| `device=`, `role=`, `provider=`, `module=` | nodes with that attribute (`role=host`, `module=bgp`, ...) |
| `... \| first N`, `\| last N`, `\| random N` | only that many of the matches, in topology order; for `group:` per group |
| `!...` | removes what it matches from the result so far; a list that starts with `!` starts from every node |

`light` can only mark nodes that are monitored, and a node with `monitoring.enabled: false` is never
monitored. A selector that matches nothing is a warning at `netlab create`; one that cannot be read (a bad
regular expression, an unknown attribute) stops it with a message. Expected sessions and adjacencies are
only checked for what is actually collected, so a partial selection raises no false "missing" alarms.

**In netlab-ui** the Monitoring dialog's Setup tab has the same thing: presets (all nodes, the first 10 of
each group, 10 random nodes, routers only, host metrics only), the two selector lists, and a live preview
of which nodes they match. "Apply now" saves the selection into the topology and, if the stack is running,
restarts the monitoring containers with it (about 15 seconds; the lab is not touched). A node newly set to
full detail that needs gNMI or SNMP switched on in the device (EOS, IOS, Junos) only gets that when the lab
is deployed. The API is `GET/PUT /api/lab/monitoring/scope` and `POST .../scope/preview`.

## Settings

All optional -- in the topology (`monitoring:`), or for every lab in `~/.netlab.yml`
(`defaults.monitoring.*`). See [`defaults.yml`](plugin/monitoring/defaults.yml).

| Setting | Default | Meaning |
|---|---|---|
| `monitoring.placement` | `tool` | `tool`: started by `netlab up` next to the lab (host network). `node`: the collector, metrics store and Grafana are added to the lab as containerlab nodes (they get management IPs, follow the lab's lifecycle and appear on the canvas) |
| `monitoring.interval` | `15` | Scrape interval (seconds) |
| `monitoring.retention` | `7d` | How long metrics are kept |
| `monitoring.nodes` | all | Which nodes to monitor: names, groups, globs, `re:`, `group:`, picks (see above) |
| `monitoring.light` | none | Of those, the nodes that get host metrics only |
| `monitoring.seed` | `0` | Seed for `random N` picks |
| `monitoring.logs.enabled` | `false` | Loki + Vector: container logs and syslog, with a logs dashboard |
| `monitoring.alerts.notify` | none | `webhook`, `slack` or `email` target for firing alerts (starts Alertmanager) |
| `monitoring.grafana.enabled` | `true` | `false` keeps just the metrics store (use your own Grafana, or only netlab-ui) |
| `monitoring.ports.*` | 3000, 8428, … | Host ports (netlab multilab adds the lab id) |
| node `monitoring.enabled: false` | | Skip a node |
| node `monitoring.method` | profile | Override how a node is collected (`frr`, `gnmi`, `snmp`, `host`) |
| node `monitoring.exporters` | | Extra Prometheus exporters on the node, e.g. `[ { port: 9100 } ]` |

With `placement: tool` the stack listens on the lab host's ports. `netlab up` checks them first and stops
with a message naming the port and the `monitoring.ports.*` setting to change if another program already holds
one (for example a dev server on 3000), instead of starting a Grafana that can never bind.

## Adding a device type (no code)

How a device is collected is data -- `defaults.monitoring.profiles.<device>`:

```yaml
defaults.monitoring.profiles:
  mydevice:
    method: gnmi              # frr | gnmi | snmp | host
    config: monitoring        # optional: <plugin>/<device or os>.j2 enables gNMI/SNMP on the device
    gnmi: { port: 57400, username: admin, password: admin, tls: skip-verify, mapping: openconfig }
  frr-clone: { use: frr }     # inherit another profile
```

A device without a profile still gets host-side metrics (CPU, memory, interfaces). gNMI metrics
are mapped onto the `netlab_*` names by [`gnmi/netlab_map.star`](plugin/monitoring/gnmi/netlab_map.star)
(one table per protocol); SNMP counters by the relabel rules in `render.py`.

Bring your own tools: `monitoring/tsdb/scrape.yml` is a plain Prometheus scrape config and
the collector serves plain Prometheus text on `127.0.0.1:9480/metrics`, so any Prometheus,
Telegraf or Grafana can use them. Extra dashboards: drop Grafana JSON into
`monitoring/grafana/dashboards` (datasource uid `netlab`).

## Design

```
netlab create ──> plugin ──> monitoring/plan.json      (nodes, netlab names, expected sessions)
                          ├─> monitoring/collector/      (stdlib-only Python)
                          ├─> monitoring/tsdb/scrape.yml, gnmic/, grafana/, up.sh, stack.json
netlab up ──────> tool ────> collector (host /proc, docker API, FRR vty) ─┐
                          ├─> gnmic (gNMI devices only) ───────────────────┼─> VictoriaMetrics ─> Grafana / netlab-ui
                          └─> snmp_exporter (SNMP devices only) ───────────┘
```

* **No per-node processes, no `docker exec`, no management network needed** for containers:
  the collector reads `/proc/<pid>/net/dev`, the container's cgroup and its own sysfs, and
  talks to FRR's daemons over their unix sockets through `/proc/<pid>/root`. That also covers
  labs without a management network (for example beyond the Linux bridge's 1024-port limit).
* **Counters and timestamps, not just states**: SPF runs, neighbor state changes, BGP
  connections established/dropped, link carrier changes, and the time of the last change.
  Convergence and flaps are exact even with a 15-second scrape.
* The collector collects when it is scraped (fresh data within one interval) and costs
  roughly one core-percent per hundred nodes.

Optional parts, off unless asked for: **vmalert** always runs the alert rules; **Alertmanager**
only with `monitoring.alerts.notify`; **Loki + Vector** only with `monitoring.logs.enabled`.

### Where things are

| To change... | Look at |
|---|---|
| What is collected from a device type | `defaults.yml` (profiles), then `collector/nlmon/` for new parsing |
| A metric (name, type, help) | `collector/nlmon/metrics.py` `FAMILIES`: dashboards, alerts, `METRICS.md` and the assistant's `list_metrics` all read it |
| A built-in dashboard | `lib/netlab_monitoring/dashboards/*.yml`, one file per board, in the same format as your own (a new file is listed in `dashboards/__init__.py`); the renderer is `panels.py` |
| User dashboards (YAML spec) | `lib/netlab_monitoring/spec.py` (compiles the format the built-in boards use) |
| Alert rules, notification targets | `alerts.py`, `notify.py` |
| Logs (Loki, Vector, syslog) | `logs.py` |
| Which containers run, and how | `containers.py` (`up.sh` for placement `tool`, lab nodes for `node`); ports in `endpoints.py` |
| Scrape and gNMI config | `collect.py` |
| Grafana provisioning | `grafana.py` |
| What lands in `<lab>/monitoring/` | `render.py` (`render_all`) |

`tests/test_extend.py` fails if a built-in dashboard or rule uses a metric that is not in
`FAMILIES`, so renaming a metric cannot silently break a panel.

### Scale (measured in the development VM, 4 vCPU)

600 containers without a management network (500 Linux hosts + 100 FRR routers running
OSPF, IS-IS, BGP and BFD daemons), one collection cycle:

| Collector | Wall time | CPU time | Memory |
|---|---|---|---|
| Python, 1 thread | 0.48 s | 0.28 s | 26 MB |
| Python, 2 threads (default) | 0.56 s | 0.59 s | 26 MB |
| Go port of the same loop | 0.43 s | 0.33 s | 15 MB |

The cost is dominated by syscalls and FRR's own reply time, not the language, so the collector
stays in Python (stdlib only, runs on the stock `python:alpine` image). At 2000 nodes expect
about 1.6 s per cycle, well inside a 15-second interval.

## What is tested where

| | Status |
|---|---|
| FRR (OSPF, IS-IS, BGP, BFD, routes) via vty sockets | Tested against live FRR 10.4 routers, incl. a link flap |
| VXLAN / EVPN VNIs (`show evpn vni json`) | Reply captured from live FRR 10.7.1 (one L2 and one L3 VNI) and parsed in tests; MAC, ARP/ND and remote-VTEP counts are not yet checked against a running two-VTEP fabric. gNMI and SNMP devices report no VNIs yet, so no VNI is expected on them |
| Host metrics, cgroup v1 | Tested live; cgroup v2 and libvirt with fixtures |
| `placement: tool` and `placement: node` | Tested live (containers started from netlab's `clab.yml`) |
| gNMI, SR Linux native (interfaces, BGP, OSPF, IS-IS) | Tested live on two SR Linux 26.3.2 containers running OSPF, IS-IS and iBGP: every adjacency arrives with the right node, interface and peer labels and matches what the topology expects. That run found and fixed a wrong IS-IS path (which made SR Linux reject the whole subscription), an interface-name mismatch and a float BGP AS. Also collected, so the convergence panels have data: SPF run counts and times, adjacency/session change counts and times, BGP updates and messages, and route counts per address family (reported as protocol `all`, SR Linux has no split by routing protocol). **Not available from SR Linux**: SPF duration, OSPF LSA counts by type and retransmissions, so those panels stay empty for it |
| gNMI, OpenConfig (Arista cEOS, Juniper) | Paths follow the OpenConfig models; config and mapping tested on sample events -- **not yet run against a real device** |
| SNMP (IOS, NX-OS) | Config rendering tested -- **needs a run against real devices** |
| libvirt VMs | Tested on a real KVM host (libvirt 12.2, cgroup v2); upstream is sunsetting libvirt, so this stays best-effort |
| Logs (Loki + Vector) | Tested live with the real Loki, Vector and Grafana images on a two-router FRR lab: container logs reach Loki labelled by node, a syslog line sent to UDP 1514 arrives labelled with node, severity and `source=syslog`, Grafana's Loki datasource is healthy and the logs dashboard is provisioned. **Syslog sent by a device container was not verified**: the test machine's host firewall dropped it (see the note under Logs) |
| Alert notifications (Alertmanager) | Config validated by the real image; an alert reached a webhook through Alertmanager |

## Tests

```bash
python -m pytest monitoring/tests      # needs netlab's Python (python-box, PyYAML)
```
