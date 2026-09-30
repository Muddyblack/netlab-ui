# netlab lab monitoring

A netlab **plugin** that adds monitoring to any lab, for every device type, with nothing
installed in the devices and no change to netlab itself:

* **Every container and libvirt VM**: CPU, memory and per-interface traffic, errors, drops,
  link state and link flaps -- read on the lab host (`/proc`, cgroups, libvirt state).
* **Routing protocol state**: OSPF, IS-IS, BGP, BFD and routing-table size, chosen per device:
  FRR-based devices through the FRR daemons' own sockets, gNMI devices (SR Linux, Arista,
  Juniper) through gnmic, SNMP devices through snmp_exporter.
* **What the topology intends**: every BGP session and OSPF/IS-IS adjacency netlab configured,
  so "defined but not up" works the same for every vendor.
* **Storage and dashboards**: VictoriaMetrics (Prometheus-compatible, light at scale) and
  Grafana with three dashboards: lab overview (with a live topology graph), routing &
  convergence (flaps per router, OSPF neighbor states, BGP per peer, SPF, LSAs), node detail.

Every metric carries netlab names -- `node`, `ifname`, `link`, `peer_node` -- so a query or a
dashboard never needs to know which vendor or collection method produced it.

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

* **Health**: nodes, BGP sessions and OSPF/IS-IS adjacencies up vs what the topology defines,
  what is missing, and buttons for the dashboards.
* **Fault tests**: repeatable link flaps (see below).
* **Setup**: where the stack runs, start/stop, and how each node is collected.

### Dashboard event bands

The shaded bands on the dashboards are events netlab-ui records in Grafana: **Link outages**
(orange: a link taken down from the UI, until it came back up) and **Fault tests** (purple:
one band per down period of a fault test). Each has a toggle at the top of every dashboard.

### Fault tests (repeatable link flaps)

Pick one or more link ends, the number of cycles and how long each link stays down and up.
netlab-ui takes the links down and up on that schedule (containers with `ip link`, libvirt
VMs with `virsh domif-setlink`) and samples the collector about twice a second. For every
cycle it reports:

| | |
|---|---|
| Reaction | Time from link down until a session/adjacency the topology defines went down |
| Impact | How many were down at the worst moment (and which) |
| Recovery | Time from link up until everything the topology defines was up again. Taken from the devices' own "last changed" timestamps where they report them (FRR: whole seconds, so `0 s` means under a second), otherwise at sampling resolution |

Runs are saved in `monitoring/scenarios/*.json` next to the topology, so a change (timers,
BFD, a different design) can be compared run against run. The same is available over the
API: `POST /api/lab/monitoring/scenarios`.

![Fault tests in netlab-ui](docs/netlab-ui-fault-tests.png)

## Settings

All optional -- in the topology (`monitoring:`), or for every lab in `~/.netlab.yml`
(`defaults.monitoring.*`). See [`defaults.yml`](plugin/monitoring/defaults.yml).

| Setting | Default | Meaning |
|---|---|---|
| `monitoring.placement` | `tool` | `tool`: started by `netlab up` next to the lab (host network). `node`: the collector, metrics store and Grafana are added to the lab as containerlab nodes (they get management IPs, follow the lab's lifecycle and appear on the canvas) |
| `monitoring.interval` | `15` | Scrape interval (seconds) |
| `monitoring.retention` | `7d` | How long metrics are kept |
| `monitoring.nodes` | all | Monitor only these nodes or groups |
| `monitoring.grafana.enabled` | `true` | `false` keeps just the metrics store (use your own Grafana, or only netlab-ui) |
| `monitoring.ports.*` | 3000, 8428, … | Host ports (netlab multilab adds the lab id) |
| node `monitoring.enabled: false` | | Skip a node |
| node `monitoring.method` | profile | Override how a node is collected (`frr`, `gnmi`, `snmp`, `host`) |
| node `monitoring.exporters` | | Extra Prometheus exporters on the node, e.g. `[ { port: 9100 } ]` |

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
| Host metrics, cgroup v1 | Tested live; cgroup v2 and libvirt with fixtures |
| `placement: tool` and `placement: node` | Tested live (containers started from netlab's `clab.yml`) |
| gnmic config + mapping (SR Linux native, OpenConfig) | gnmic loads the config; mapping tested with `gnmic processor` on sample events -- **needs a run against real SR Linux / cEOS** |
| SNMP (IOS, NX-OS) | Config rendering tested -- **needs a run against real devices** |
| libvirt VMs | Unit tests with libvirt state files -- **needs a run on a KVM host** |

## Tests

```bash
python -m pytest monitoring/tests      # needs netlab's Python (python-box, PyYAML)
```
