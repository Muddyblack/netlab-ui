#!/usr/bin/env bash
# Install netlab-ui on this Linux machine, the way containerlab's installer does:
#
#   curl -fsSL https://raw.githubusercontent.com/Muddyblack/netlab-ui/main/packaging/install.sh | bash
#
# Options (pass after `bash -s --` when piping):
#   --with-netlab          also install netlab and Ansible next to the GUI (skip if you already have netlab)
#   --with-containerlab    also run containerlab's installer (Docker, containerlab, the clab_admins group); needs sudo
#   --service              install and start a systemd user service
#   --version X.Y.Z        install a specific release instead of the latest
#
# Update later with:  netlab-ui upgrade
set -euo pipefail

PACKAGE="netlab-ui"
with_netlab=0
with_clab=0
service=0
version=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-netlab) with_netlab=1 ;;
    --with-containerlab) with_clab=1 ;;
    --service) service=1 ;;
    --version) version="${2:?--version needs a value}"; shift ;;
    -h | --help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "this installer is for Linux. On Windows/macOS install the desktop app and connect it to a Linux lab server."
[[ "$(id -u)" -ne 0 ]] || die "run this as your normal user, not root: labs and the service belong to you."

python="$(command -v python3 || true)"
[[ -n "$python" ]] || die "python3 is not installed (3.11 or newer is required)."
"$python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' \
  || die "Python 3.11+ is required, found $("$python" -V). Install a newer python3, then run this again."

if ! command -v pipx >/dev/null; then
  say "pipx not found; installing it for your user"
  "$python" -m pip install --user pipx 2>/dev/null \
    || die "could not install pipx. Install it with your package manager (apt install pipx / dnf install pipx), then run this again."
  "$python" -m pipx ensurepath >/dev/null || true
  pipx() { "$python" -m pipx "$@"; }
fi

spec="$PACKAGE"
[[ $with_netlab -eq 1 ]] && spec="$PACKAGE[netlab]"
[[ -n "$version" ]] && spec="$spec==$version"

say "installing $spec"
pipx install --force "$spec"

if [[ $with_clab -eq 1 ]]; then
  say "installing containerlab (Docker, containerlab and the clab_admins group; asks for sudo)"
  curl -fsSL https://containerlab.dev/setup | sudo -E bash -s "all"
  echo "Log out and back in so the new docker/clab_admins group membership applies."
fi

# pipx puts the command in ~/.local/bin, which may not be on PATH until the next login.
export PATH="$HOME/.local/bin:$PATH"

if [[ $service -eq 1 ]]; then
  say "installing the systemd user service"
  netlab-ui install-service
fi

cat <<EOF

netlab-ui is installed.
  start it now      netlab-ui            (then open http://127.0.0.1:8000)
  run as a service  netlab-ui install-service   (starts at boot, checks it came up)
  settings          netlab-ui config
  update later      netlab-ui upgrade
The first time you open the UI it checks this machine (netlab, containerlab, Docker access) and says what is missing.
EOF
