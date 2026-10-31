#!/usr/bin/env bash
# Smoke tests for what users actually install, run before a release publishes it.
#
#   scripts/smoke-test.sh wheel <file.whl> [expected-version]   install into a clean venv and start it
#   scripts/smoke-test.sh url   <base-url>                      check an already running server
#
# Both check the API (/api/health) and the bundled frontend (/). The wheel mode also checks the
# version and that the monitoring plugin is bundled.
set -euo pipefail

# Poll until the API answers, then check the API and the UI. $1 = base URL.
check_url() {
    local base="${1%/}" i
    for i in $(seq 1 60); do
        curl -fsS "$base/api/health" >/dev/null 2>&1 && break
        [[ $i -eq 60 ]] && { echo "::error::$base/api/health did not answer within 60s" >&2; return 1; }
        sleep 1
    done
    curl -fsS "$base/api/health" >/dev/null
    local index
    index="$(curl -fsS "$base/")"
    grep -qi '<div id="root"\|<html' <<<"$index" || { echo "::error::$base/ is not the bundled frontend" >&2; return 1; }
    echo "ok: API and frontend answer at $base"
}

check_wheel() {
    local wheel="$1" expected="${2:-}" tmp pid port=18765
    tmp="$(mktemp -d)"
    trap 'kill "${pid:-0}" 2>/dev/null || true; rm -rf "$tmp"' RETURN

    python3 -m venv "$tmp/venv"
    "$tmp/venv/bin/pip" install --quiet "$wheel"

    local got
    got="$("$tmp/venv/bin/netlab-ui" --version)"
    echo "$got"
    if [[ -n "$expected" && "$got" != *"$expected" ]]; then
        echo "::error::wheel reports '$got', expected $expected" >&2
        return 1
    fi

    # The files the wheel must carry besides the Python code (see scripts/build-wheel.sh).
    "$tmp/venv/bin/python" - <<'PY'
import importlib.resources as r, sys
root = r.files("netlab_ui")
missing = [p for p in ("_frontend/index.html", "_monitoring_plugin/__init__.py", "_monitoring_plugin/defaults.yml")
           if not root.joinpath(p).is_file()]
if missing:
    sys.exit(f"wheel is missing: {', '.join(missing)}")
print("ok: bundled frontend and monitoring plugin are in the wheel")
PY

    # Isolated HOME so the run neither reads nor writes the runner user's config.
    HOME="$tmp/home" "$tmp/venv/bin/netlab-ui" serve --host 127.0.0.1 --port "$port" >"$tmp/server.log" 2>&1 &
    pid=$!
    check_url "http://127.0.0.1:$port" || { cat "$tmp/server.log" >&2; return 1; }
}

case "${1:-}" in
    wheel) [[ -n "${2:-}" ]] || { echo "usage: $0 wheel <file.whl> [version]" >&2; exit 2; }; check_wheel "$2" "${3:-}" ;;
    url) [[ -n "${2:-}" ]] || { echo "usage: $0 url <base-url>" >&2; exit 2; }; check_url "$2" ;;
    *) echo "usage: $0 wheel <file.whl> [version] | url <base-url>" >&2; exit 2 ;;
esac
