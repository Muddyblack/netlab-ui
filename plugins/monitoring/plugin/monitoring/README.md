# monitoring

Adds monitoring to any lab, for every device type, with nothing installed in the devices:
metrics with netlab names (`node`, `ifname`, `link`, `peer_node`), stored in VictoriaMetrics
and shown in Grafana.

```yaml
plugin: [ monitoring ]
```

`netlab up` writes `monitoring/` next to the topology, starts the stack after the lab and prints
the Grafana URL (`http://<host>:3000`, anonymous read-only; `admin`/`admin` to edit).
`netlab down` stops it; the metrics stay in `monitoring/data`.

## What it collects

| Source | How | Devices |
|---|---|---|
| CPU, memory, interface traffic, errors, drops, link state and flaps | On the lab host (`/proc`, cgroups, libvirt state) | Every container and libvirt VM |
| OSPF, IS-IS, BGP, BFD, routing-table size | FRR daemons' vty sockets | FRR, Cumulus, VyOS |
| The same, through OpenConfig | gNMI (gnmic) | SR Linux, Arista EOS, Junos |
| Interfaces | SNMP (snmp_exporter) | IOS, IOS XE, NX-OS |
| What the topology intends | netlab's own data | All: every BGP session and OSPF/IS-IS adjacency netlab configured |

So "defined but not up" works the same for every vendor.

## Dashboards

**Lab overview**, **Routing and convergence** and **Node detail**, with a lab picker and a node
picker. Toggles at the top switch markers on the graphs:

| Toggle | Default | Shows |
|---|---|---|
| Link outages | on | A link taken down from netlab-ui, until it came back up |
| Fault tests | on | Each down period of a fault test |
| SPF runs | off | When a router ran OSPF or IS-IS SPF |
| Neighbor changes | off | When an adjacency or BGP session last changed |

Your own dashboards (Grafana JSON or a short YAML spec) go in `monitoring/dashboards/`, alert
rules in `monitoring/alerts/*.yml`. Both go live within about 10 seconds and are never
overwritten by `netlab create`. `monitoring/METRICS.md` lists every metric.

## Fault tests

Repeatable link flaps, timed per cycle (reaction, impact, recovery) and checked with
`netlab validate` tests:

```yaml
monitoring.faults:
  core_link:
    description: Lose the r1-r2 link
    links: [ r1-r2 ]
    cycles: 3
    down: 10
    up: 30
    validate: [ ospf_r2 ]     # netlab validate tests run after recovery
    expect.recovery: 5        # slower recovery fails the run
```

In netlab-ui: **Monitoring…** → **Fault tests** → **Run**.

## Settings

Per lab under `monitoring:`, or for all labs in `~/.netlab.yml` under `defaults.monitoring`:

| Setting | Default | |
|---|---|---|
| `placement` | `tool` | `tool`: containers started by `netlab up`; `node`: lab nodes on the canvas |
| `interval` | `15` | Collection interval in seconds |
| `retention` | `7d` | How long metrics are kept |
| `logs.enabled` | `false` | Loki and Vector: container logs and syslog (UDP 1514) |
| `alerts.notify` | `{}` | `webhook`, `slack` or `email` targets for firing alerts |
| `grafana.anonymous_role` | `Viewer` | Viewer, Editor or Admin |
| `ports.grafana` | `3000` | Host ports of the stack (`tsdb` 8428, `vmalert` 8880, ...) |
| `profiles.<device>` | | How each device type is collected (`frr`, `gnmi`, `snmp`, `host`) |

The complete guide is `monitoring/README.md` in the netlab-ui repository.
