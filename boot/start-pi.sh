#!/usr/bin/env bash
# ~/.pi/start-pi.sh — Launch Pi coding agent in a dedicated tmux session
# Called by systemd on boot or manually via: bash ~/.pi/start-pi.sh
#
# Attach to the running session with:
#   tmux attach -t pi-agent

set -euo pipefail

SESSION_NAME="pi-agent"
PI_BIN="$(command -v pi 2>/dev/null || echo /usr/bin/pi)"

# Source environment for API keys
export HOME="${HOME:-/root}"
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true
[ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null || true

# If our session already exists, skip (idempotent)
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "[$(date)] Pi agent session '$SESSION_NAME' already running"
  exit 0
fi

# Unset TMUX so we can create a new session even if called from within tmux
unset TMUX

# Start Pi in a new detached tmux session
tmux new-session -d -s "$SESSION_NAME" -c "$HOME" "$PI_BIN"

echo "[$(date)] Pi agent started in tmux session '$SESSION_NAME'"
echo "  Attach with: tmux attach -t $SESSION_NAME"
echo "  Detach with: Ctrl+b, then d"
echo "  Models: Fable 5 (plan) / Sonnet 4.6 (code) / Haiku 4.5 (search)"
