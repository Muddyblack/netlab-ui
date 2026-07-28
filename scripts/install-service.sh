#!/usr/bin/env bash
# ==============================================================================
# netlab-gui systemd User Service Installer / Uninstaller
# ==============================================================================
# Installs a systemd user service so netlab-gui runs in the background and
# automatically starts on system boot (like code-server).
# ==============================================================================

set -e

# Determine repository root (directory where script is located -> parent dir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SERVICE_NAME="netlab-gui"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_FILE="${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"

# Colors for terminal output
RED='\031[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== netlab-gui Service Setup ===${NC}"

# Handle Uninstall
if [[ "$1" == "--uninstall" ]]; then
    echo -e "${YELLOW}Uninstalling ${SERVICE_NAME} systemd user service...${NC}"
    if systemctl --user is-active --quiet "${SERVICE_NAME}"; then
        echo "Stopping service..."
        systemctl --user stop "${SERVICE_NAME}"
    fi
    if systemctl --user is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
        echo "Disabling service..."
        systemctl --user disable "${SERVICE_NAME}"
    fi
    if [[ -f "${SERVICE_FILE}" ]]; then
        rm -f "${SERVICE_FILE}"
        echo "Removed ${SERVICE_FILE}"
    fi
    systemctl --user daemon-reload
    echo -e "${GREEN}✓ ${SERVICE_NAME} service successfully uninstalled.${NC}"
    exit 0
fi

# Detect runtime command (Prefer `nix run`, fallback to `docker compose up`)
EXEC_CMD=""
if command -v nix &> /dev/null; then
    EXEC_CMD="$(command -v nix) run"
    RUNNER_DESC="Nix Flake (nix run)"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    EXEC_CMD="$(command -v docker) compose up"
    RUNNER_DESC="Docker Compose"
else
    echo -e "${RED}Error: Neither 'nix' nor 'docker compose' was found in PATH.${NC}"
    echo "Please install Nix or Docker to run netlab-gui as a service."
    exit 1
fi

echo -e "Repo directory : ${GREEN}${REPO_DIR}${NC}"
echo -e "Runner detected: ${GREEN}${RUNNER_DESC}${NC} (${EXEC_CMD})"
echo -e "Service file   : ${GREEN}${SERVICE_FILE}${NC}"
echo ""

# Ensure systemd user directory exists
mkdir -p "${SYSTEMD_USER_DIR}"

# Create Systemd User Service Unit
cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=netlab-gui Service (Autostart on boot)
After=network.target docker.service
Wants=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=${EXEC_CMD}
Restart=always
RestartSec=5s
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}

[Install]
WantedBy=default.target
EOF

echo -e "${GREEN}✓ Created systemd service unit.${NC}"

# Reload systemd user daemon
echo "Reloading systemd user daemon..."
systemctl --user daemon-reload

# Enable linger so systemd user services start on PC boot before interactive login
if command -v loginctl &> /dev/null; then
    echo "Enabling linger for user ${USER} (ensures autostart on boot)..."
    loginctl enable-linger "${USER}" 2>/dev/null || true
fi

# Enable and start the service
echo "Enabling and starting ${SERVICE_NAME}.service..."
systemctl --user enable --now "${SERVICE_NAME}"

echo ""
echo -e "${GREEN}=====================================================${NC}"
echo -e "${GREEN}  netlab-gui systemd service installed & started!  ${NC}"
echo -e "${GREEN}=====================================================${NC}"
echo ""
echo "Useful commands:"
echo "  Check status : systemctl --user status ${SERVICE_NAME}"
echo "  View logs    : journalctl --user -u ${SERVICE_NAME} -f"
echo "  Restart      : systemctl --user restart ${SERVICE_NAME}"
echo "  Stop service : systemctl --user stop ${SERVICE_NAME}"
echo "  Uninstall    : ${0} --uninstall"
echo ""
