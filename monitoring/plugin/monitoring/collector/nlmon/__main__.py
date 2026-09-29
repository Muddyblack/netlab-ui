"""python -m nlmon --plan plan.json [--listen :9480] [--once]"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import signal
import sys
import threading

from . import __version__
from .collector import Collector, Plan, default_paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="nlmon", description="netlab monitoring collector")
    parser.add_argument("--plan", required=True, help="collection plan written by the netlab monitoring plugin")
    parser.add_argument("--listen", default=":9480", help="[address]:port for /metrics (default :9480)")
    parser.add_argument("--once", action="store_true", help="collect once, print the metrics and exit")
    parser.add_argument("--proc", help="host /proc (default: /host/proc if mounted, else /proc)")
    parser.add_argument("--sys", dest="sysfs", help="host /sys (default: /host/sys if mounted, else /sys)")
    parser.add_argument("--docker-socket", help="Docker or Podman API socket")
    parser.add_argument("--libvirt-run", help="libvirt runtime directory (default /run/libvirt)")
    args = parser.parse_args(argv)

    paths = default_paths()
    for attr, value in (
        ("proc", args.proc),
        ("sysfs", args.sysfs),
        ("docker_socket", args.docker_socket),
        ("libvirt_run", args.libvirt_run),
    ):
        if value:
            setattr(paths, attr, value)
    collector = Collector(Plan.load(args.plan), paths)

    if args.once:
        sys.stdout.write(collector.cycle())
        return 0

    stop = threading.Event()
    worker = threading.Thread(target=collector.run_forever, args=(stop,), daemon=True)
    worker.start()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path.startswith("/metrics"):
                body, ctype = collector.text.encode(), "text/plain; version=0.0.4; charset=utf-8"
            elif self.path.startswith("/healthz"):
                body, ctype = b"ok\n", "text/plain"
            else:
                body = f"netlab monitoring collector {__version__}: see /metrics\n".encode()
                ctype = "text/plain"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_: object) -> None:
            pass

    host, _, port = args.listen.rpartition(":")
    server = http.server.ThreadingHTTPServer((host or "0.0.0.0", int(port)), Handler)
    signal.signal(signal.SIGTERM, lambda *_: (stop.set(), threading.Thread(target=server.shutdown).start()))
    print(f"nlmon {__version__}: {len(collector.plan.nodes)} nodes, listening on {args.listen}", flush=True)
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
    stop.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
