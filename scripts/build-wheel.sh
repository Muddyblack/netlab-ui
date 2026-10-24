#!/usr/bin/env bash
# Build the netlab-gui-backend wheel + sdist with the UI and the monitoring plugin bundled inside:
#   netlab_gui/_frontend           <- frontend/dist
#   netlab_gui/_monitoring_plugin  <- monitoring/plugin/monitoring
# Output lands in backend/dist/. The copied directories are git-ignored.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkg="$root/backend/netlab_gui"

(cd "$root/frontend" && npm ci && npm run build)

rm -rf "$pkg/_frontend" "$pkg/_monitoring_plugin"
cp -r "$root/frontend/dist" "$pkg/_frontend"
cp -r "$root/monitoring/plugin/monitoring" "$pkg/_monitoring_plugin"
find "$pkg/_monitoring_plugin" -name __pycache__ -prune -exec rm -rf {} +

(cd "$root/backend" && rm -rf dist && python -m build)
ls -l "$root/backend/dist"
