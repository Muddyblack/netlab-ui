"""netlab monitoring collector.

A single process per lab that turns the running lab into Prometheus metrics with
netlab names (node, interface, link, peer) on every sample:

* every container node: CPU, memory, interface counters and link state, read from the
  host (/proc, cgroups) -- no ``docker exec``, no network access to the node;
* every libvirt VM: CPU, memory and tap interface counters (libvirt runtime state files);
* FRR-based nodes: OSPF, IS-IS, BGP, BFD and route-table state, read straight from the
  FRR daemons' vty sockets through /proc/<pid>/root -- works without a management network;
* the intended state from the netlab topology (which adjacencies and sessions should exist).

Standard library only, so it runs on a stock python image. The collection plan
(``plan.json``) is written by the netlab ``monitoring`` plugin at ``netlab create`` time.
"""

__version__ = "0.1.0"
