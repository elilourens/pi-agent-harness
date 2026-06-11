# Pi Agent Harness

Multi-model coding agent powered by [Pi](https://pi.dev) with automatic tool-based model routing.

## Models

| Role | Model | Trigger |
|------|-------|---------|
| Planning & orchestration | Claude Fable 5 | Default for every new message |
| Code writing | Claude Sonnet 4.6 | `write_file`, `edit_file`, `bash`, etc. |
| Web search | Claude Haiku 4.5 | `web_search`, `browser`, `fetch` |
| Heavy reasoning | Claude Opus 4.8 | Manual only (`/opus`) |

The router doesn't guess from keywords — it watches which tools the LLM reaches for and swaps to the right model automatically.

## Quick Setup

```bash
# 1. Install Pi
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2. Clone this repo
git clone https://github.com/YOUR_USERNAME/pi-agent-harness.git
cd pi-agent-harness

# 3. Run the install script
./install.sh
```

You'll be prompted for your Anthropic API key during install.

## Manual Setup

```bash
# Copy config files
mkdir -p ~/.pi/agent/extensions
cp config/settings.json ~/.pi/agent/settings.json
cp config/extensions/model-router.ts ~/.pi/agent/extensions/model-router.ts

# Set your API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Run Pi
pi
```

## Auto-Start on Boot

```bash
./install.sh --with-boot
```

This creates a systemd service that launches Pi in a tmux session on boot. Attach with:

```bash
tmux attach -t pi-agent
```

## Commands

| Command | Effect |
|---------|--------|
| `/plan` | Force Fable 5 (planning) |
| `/code` | Force Sonnet 4.6 (coding) |
| `/search` | Force Haiku 4.5 (search) |
| `/opus` | Force Opus 4.8 (heavy reasoning) |
| `/router-status` | Show current routing state |

## How Routing Works

```
User message arrives
  → Fable 5 (planner) thinks about it
    → LLM calls write_file → swap to Sonnet 4.6
    → LLM calls web_search → swap to Haiku 4.5 → back to Fable 5
    → LLM calls read_file  → no swap (neutral tool)
Next user message
  → Reset to Fable 5
```

## License

MIT
