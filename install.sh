#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="${HOME}/.pi"
AGENT_DIR="${PI_DIR}/agent"

echo "=== Pi Agent Harness Setup ==="
echo ""

# ── Check Pi is installed ─────────────────────────────────────────────
if ! command -v pi &>/dev/null; then
  echo "Pi not found. Installing..."
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  echo ""
fi
echo "Pi version: $(pi --version)"
echo ""

# ── Copy config files ─────────────────────────────────────────────────
mkdir -p "${AGENT_DIR}/extensions"

cp "${SCRIPT_DIR}/config/settings.json" "${AGENT_DIR}/settings.json"
echo "✓ settings.json"

cp "${SCRIPT_DIR}/config/extensions/model-router.ts" "${AGENT_DIR}/extensions/model-router.ts"
echo "✓ model-router.ts"

# ── API key ───────────────────────────────────────────────────────────
if [ -f "${AGENT_DIR}/auth.json" ]; then
  echo "✓ auth.json already exists (keeping existing key)"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  cat > "${AGENT_DIR}/auth.json" << AUTHEOF
{
  "anthropic": {
    "apiKey": "${ANTHROPIC_API_KEY}"
  }
}
AUTHEOF
  chmod 600 "${AGENT_DIR}/auth.json"
  echo "✓ auth.json (from ANTHROPIC_API_KEY env var)"
else
  echo ""
  echo "No API key found. Enter your Anthropic API key (sk-ant-...):"
  read -r -s API_KEY
  cat > "${AGENT_DIR}/auth.json" << AUTHEOF
{
  "anthropic": {
    "apiKey": "${API_KEY}"
  }
}
AUTHEOF
  chmod 600 "${AGENT_DIR}/auth.json"
  echo "✓ auth.json"
fi

# ── Boot service (optional) ───────────────────────────────────────────
if [ "${1:-}" = "--with-boot" ]; then
  echo ""
  echo "Setting up auto-start on boot..."

  cp "${SCRIPT_DIR}/boot/start-pi.sh" "${PI_DIR}/start-pi.sh"
  chmod +x "${PI_DIR}/start-pi.sh"

  # Adjust paths for current user
  CURRENT_USER="$(whoami)"
  CURRENT_HOME="${HOME}"

  sudo tee /etc/systemd/system/pi-agent.service > /dev/null << SVCEOF
[Unit]
Description=Pi Coding Agent (tmux session)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${CURRENT_USER}
Environment=HOME=${CURRENT_HOME}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${PI_DIR}/start-pi.sh
ExecStop=/usr/bin/tmux kill-session -t pi-agent

[Install]
WantedBy=multi-user.target
SVCEOF

  sudo systemctl daemon-reload
  sudo systemctl enable pi-agent.service
  echo "✓ systemd service enabled"
  echo "  Start now with: sudo systemctl start pi-agent"
  echo "  Attach with:    tmux attach -t pi-agent"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Run 'pi' to start, or use the boot service."
echo "Commands: /plan /code /search /opus /router-status"
