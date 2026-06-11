#!/usr/bin/env bash
# Pi agent harness setup. Use --with-boot for a systemd auto-start service.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PI_DIR="$HOME/.pi"
AGENT="$PI_DIR/agent"

command -v pi &>/dev/null || npm install -g --ignore-scripts @earendil-works/pi-coding-agent
echo "Pi version: $(pi --version)"

mkdir -p "$AGENT/extensions"
cp "$DIR/config/settings.json" "$AGENT/settings.json"
cp "$DIR/config/extensions/model-router.ts" "$AGENT/extensions/model-router.ts"
echo "✓ config installed"

# API key → auth.json (keep existing; else env var; else prompt)
if [ ! -f "$AGENT/auth.json" ]; then
  KEY="${ANTHROPIC_API_KEY:-}"
  if [ -z "$KEY" ]; then
    echo "Enter your Anthropic API key (sk-ant-...):"
    read -r -s KEY
  fi
  printf '{\n  "anthropic": { "apiKey": "%s" }\n}\n' "$KEY" > "$AGENT/auth.json"
  chmod 600 "$AGENT/auth.json"
fi
echo "✓ auth.json"

if [ "${1:-}" = "--with-boot" ]; then
  cp "$DIR/boot/start-pi.sh" "$PI_DIR/start-pi.sh"
  chmod +x "$PI_DIR/start-pi.sh"
  sudo tee /etc/systemd/system/pi-agent.service > /dev/null << EOF
[Unit]
Description=Pi Coding Agent (tmux session)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=$(whoami)
Environment=HOME=$HOME
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$PI_DIR/start-pi.sh
ExecStop=/usr/bin/tmux kill-session -t pi-agent

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable pi-agent.service
  echo "✓ systemd service enabled (start: sudo systemctl start pi-agent)"
fi

echo "Done. Run 'pi' to start. Commands: /plan /code /search /opus /router-status"
