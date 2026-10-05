#!/usr/bin/env bash
# Regenerate the showcase: stills, videos and the README gallery.
#
#   docs/showcase/run.sh                  everything
#   docs/showcase/run.sh --only canvas    one feature (requires matching source)
#   docs/showcase/run.sh --resume         continue a failed run, skipping the features it finished
#   docs/showcase/run.sh --list           list features
#   docs/showcase/run.sh --check          check published media against source
#   docs/showcase/run.sh --teardown       stop labs left running by an interrupted run
#
# Runs an isolated netlab-ui on 127.0.0.1 (own HOME and workspace under
# .work/, so your labs and netlab's lab registry stay out of the pictures),
# deploys the showcase labs with containerlab where a feature needs them, and
# tears everything down afterwards. Other options go to showcase.mjs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="$here/.work"
port="${SHOWCASE_PORT:-8765}"
args=()
for arg in "$@"; do
  # Kept for old invocations; every recording now gets a clean build.
  if [[ "$arg" != "--build" ]]; then args+=("$arg"); fi
done

if [[ " ${args[*]-} " == *" --teardown "* ]]; then
  [[ $EUID -ne 0 ]] && sudo -v
  found=0
  for lab in "$work"/workspace/*/; do
    if [[ -f "$lab/netlab.lock" ]]; then
      found=1
      echo "· netlab down $(basename "$lab")"
      (cd "$lab" && HOME="$work/home" PWD="$lab" netlab down --cleanup) || echo "  netlab down failed for $lab" >&2
    fi
  done
  [[ $found -eq 0 ]] && echo "· no showcase lab is deployed"
  exit 0
fi

if [[ " ${args[*]-} " == *" --list "* || " ${args[*]-} " == *" --check "* || " ${args[*]-} " == *" --preflight "* ]]; then
  exec node "$here/showcase.mjs" "${args[@]}"
fi

# netlab deploys through sudo; authenticate once and keep it fresh for the
# whole recording (lab teardown in cleanup needs it too).
if [[ $EUID -ne 0 ]]; then
  sudo -v
  (while sleep 60; do sudo -n true 2>/dev/null || exit; done) &
  sudo_keepalive=$!
  trap 'kill "$sudo_keepalive" 2>/dev/null || true' EXIT
fi

node "$here/showcase.mjs" --preflight "${args[@]}"

backend="$repo/backend"
# The backend's Python: backend/.venv if there is one, otherwise whatever is on
# PATH (the Nix dev shell / direnv provides uvicorn with every dependency).
# A venv whose interpreter was garbage-collected (Nix store path) doesn't count.
if [[ -x "$backend/.venv/bin/uvicorn" ]] && (cd "$backend" && .venv/bin/python3 -c "import app.main" >/dev/null 2>&1); then
  export PATH="$backend/.venv/bin:$PATH"
elif ! command -v uvicorn >/dev/null || ! (cd "$backend" && python3 -c "import app.main" >/dev/null 2>&1); then
  echo "no backend environment: create backend/.venv or enter the Nix dev shell (see CONTRIBUTING.md)" >&2
  exit 1
fi
if [[ ! -d "$here/node_modules/playwright-core" ]]; then
  echo "· installing playwright-core (once, no browser download)"
  (cd "$here" && npm install --silent --no-audit --no-fund >/dev/null)
fi
export SHOWCASE_SOURCE_HASH="$(node "$here/lib/recordings.mjs")"
# Rebuild only when something under frontend/ is newer than the last build.
dist="$repo/frontend/dist/index.html"
if [[ -f "$dist" && -d "$repo/frontend/node_modules" ]] \
   && [[ -z "$(find "$repo/frontend" \( -path '*/node_modules' -o -path '*/dist' \) -prune -o -type f -newer "$dist" -print -quit)" ]]; then
  echo "· frontend unchanged since the last build: skipping install and build"
else
  echo "· installing locked frontend dependencies and building the current UI"
  (cd "$repo/frontend" && npm ci --no-audit --no-fund --silent)
  if ! build_log="$(cd "$repo/frontend" && npm run -s build 2>&1)"; then
    printf '%s\n' "$build_log" >&2
    echo "frontend build failed; no media was replaced" >&2
    exit 1
  fi
fi
if [[ "$SHOWCASE_SOURCE_HASH" != "$(node "$here/lib/recordings.mjs")" ]]; then
  echo "source changed during the frontend build; rerun the showcase" >&2
  exit 1
fi

if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
  echo "port $port is already serving something (another netlab-ui?): stop it or set SHOWCASE_PORT" >&2
  exit 1
fi

# Preserve the files needed to tear down a lab left by an interrupted run.
for lab in "$work"/workspace/*/; do
  if [[ -f "$lab/netlab.lock" ]]; then
    echo "showcase lab still deployed at $lab; run docs/showcase/run.sh --teardown, then rerun" >&2
    exit 1
  fi
done

# Fresh workspace and registry; keep the isolated home's caches. A failed
# deployment preflight can leave a registry entry without a netlab.lock.
# The monitoring containers run as root and leave root-owned data behind.
rm -rf "$work/workspace" "$work/errors" 2>/dev/null || sudo rm -rf "$work/workspace" "$work/errors"
rm -f "$work/home/.netlab/status.yaml" "$work/home/.netlab/status.yaml.lock"
mkdir -p "$work/home" "$work/workspace"
cp -R "$here/labs/." "$work/workspace/"

export ANSIBLE_COLLECTIONS_PATH="${ANSIBLE_COLLECTIONS_PATH:-$HOME/.ansible/collections:/usr/share/ansible/collections}"
export HOME="$work/home"
# Keep the sudo login from `sudo -v` valid for the backend's netlab commands.
export NETLAB_APP_KEEP_SESSION=1
export NETLAB_WORKSPACE="$work/workspace"
export NETLAB_WORKSPACE_CONFIG="$work/workspace.json"
export FRONTEND_DIST_DIR="$repo/frontend/dist"

# The showcase fabric lists the monitoring plugin, and netlab only finds it in
# ~/.netlab (here the isolated home). The UI makes the same link when you
# switch monitoring on.
mkdir -p "$HOME/.netlab"
ln -sfn "$repo/monitoring/plugin/monitoring" "$HOME/.netlab/monitoring"

cleanup() {
  for lab in "$work"/workspace/*/; do
    if [[ -f "$lab/netlab.lock" ]]; then
      echo "· netlab down $(basename "$lab")"
      (cd "$lab" && PWD="$lab" netlab down --cleanup >/dev/null 2>&1) || true
    fi
  done
  [[ -n "${backend_pid:-}" ]] && kill "$backend_pid" 2>/dev/null || true
  [[ -n "${sudo_keepalive:-}" ]] && kill "$sudo_keepalive" 2>/dev/null || true
}
trap cleanup EXIT

echo "· netlab-ui on http://127.0.0.1:$port (log: docs/showcase/.work/backend.log)"
(cd "$backend" && exec uvicorn app.main:app --host 127.0.0.1 --port "$port" >"$work/backend.log" 2>&1) &
backend_pid=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$port/api/health" >/dev/null && break
  sleep 0.5
done
if ! kill -0 "$backend_pid" 2>/dev/null || ! curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; then
  echo "backend did not start" >&2; tail -20 "$work/backend.log" >&2; exit 1
fi

node "$here/showcase.mjs" --base "http://127.0.0.1:$port" --workspace "$work/workspace" ${args[@]+"${args[@]}"}
