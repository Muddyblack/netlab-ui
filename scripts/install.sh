#!/usr/bin/env bash
# The install script moved to packaging/install.sh. This stub keeps the old curl URL working.
set -euo pipefail
script="$(curl -fsSL https://raw.githubusercontent.com/Muddyblack/netlab-ui/main/packaging/install.sh)" \
    || { echo "Could not download packaging/install.sh from GitHub." >&2; exit 1; }
exec bash -c "$script" install "$@"
