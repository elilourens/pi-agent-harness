#!/usr/bin/env bash
# Launch Pi in a tmux session (idempotent). Attach: tmux attach -t pi-agent
set -euo pipefail

SESSION="pi-agent"
export HOME="${HOME:-/root}"
source "$HOME/.bashrc" 2>/dev/null || true
source "$HOME/.profile" 2>/dev/null || true

tmux has-session -t "$SESSION" 2>/dev/null && { echo "Session '$SESSION' already running"; exit 0; }

unset TMUX
# Long cache retention: extends Anthropic prompt cache TTL from 5 min → 1 hour.
tmux new-session -d -s "$SESSION" -c "$HOME" -e "PI_CACHE_RETENTION=long" "$(command -v pi || echo /usr/bin/pi)"
echo "Pi started in tmux session '$SESSION' — attach: tmux attach -t $SESSION"
