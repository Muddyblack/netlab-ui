#!/usr/bin/env bash
# Regenerate the showcase: stills, videos and the README gallery.
#
#   docs/showcase/run.sh                  everything
#   docs/showcase/run.sh --only canvas    one feature (requires matching source)
#   docs/showcase/run.sh --list           list features
#   docs/showcase/run.sh --check          check published media against source
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

if [[ " ${args[*]-} " == *" --list "* || " ${args[*]-} " == *" --check "* || " ${args[*]-} " == *" --preflight "* ]]; then
  exec node "$here/showcase.mjs" "${args[@]}"
fi

node "$here/showcase.mjs" --preflight "${args[@]}"

backend="$repo/backend"
# The backend's Python: backend/.venv if there is one, otherwise whatever is on
# PATH (the Nix dev shell / direnv provides uvicorn with every dependency).
if [[ -x "$backend/.venv/bin/uvicorn" ]]; then
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
echo "· installing locked frontend dependencies and building the current UI"
(cd "$repo/frontend" && npm ci --no-audit --no-fund --silent && npm run -s build >/dev/null)
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
    echo "showcase lab still deployed at $lab; tear it down before rerunning" >&2
    exit 1
  fi
done

# Fresh workspace and registry; keep the isolated home's caches. A failed
# deployment preflight can leave a registry entry without a netlab.lock.
rm -rf "$work/workspace" "$work/errors"
rm -f "$work/home/.netlab/status.yaml" "$work/home/.netlab/status.yaml.lock"
mkdir -p "$work/home" "$work/workspace"
cp -R "$here/labs/." "$work/workspace/"

export ANSIBLE_COLLECTIONS_PATH="${ANSIBLE_COLLECTIONS_PATH:-$HOME/.ansible/collections:/usr/share/ansible/collections}"
export HOME="$work/home"
export NETLAB_WORKSPACE="$work/workspace"
export NETLAB_WORKSPACE_CONFIG="$work/workspace.json"
export FRONTEND_DIST_DIR="$repo/frontend/dist"

cleanup() {
  for lab in "$work"/workspace/*/; do
    if [[ -f "$lab/netlab.lock" ]]; then
      echo "· netlab down $(basename "$lab")"
      (cd "$lab" && PWD="$lab" netlab down --cleanup >/dev/null 2>&1) || true
    fi
  done
  [[ -n "${backend_pid:-}" ]] && kill "$backend_pid" 2>/dev/null || true
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
