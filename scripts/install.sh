#!/usr/bin/env bash
# The install script moved to packaging/install.sh. This stub keeps the old curl URL working.
exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/Muddyblack/netlab-ui/main/packaging/install.sh)" install "$@"
