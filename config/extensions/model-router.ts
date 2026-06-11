/**
 * model-router.ts — Pi extension for tool-based multi-model routing
 *
 * Strategy: Let the LLM decide. Start on the planner model (Fable 5).
 * When it reaches for a tool, swap to the right model for that job.
 *
 *   Fable 5    → default, planning, orchestration, analysis
 *   Sonnet 4.6 → code writing, file edits, shell commands
 *   Haiku 4.5  → web search, fetch, browsing
 *   Opus 4.8   → manual only (/opus), heavy reasoning
 *
 * Thinking level is co-routed with the model (search runs low, heavy runs high).
 * After search tools finish, returns to Fable 5 for analysis.
 * After code tools finish, stays on Sonnet (coding is usually multi-step).
 * Within a single agent run, parallel tool calls can't downgrade the mode
 * (code beats search). /plan resets back to Fable 5 when you're done coding.
 *
 * Commands:
 *   /plan /code /search /opus  — manual mode overrides
 *   /router-pause /router-resume — toggle auto-routing (manual commands still work)
 *   /router-status             — intent vs live model, request stats per model
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "anthropic";

const MODELS = {
  planner:    "claude-fable-5",
  coder:      "claude-sonnet-4-6",
  search:     "claude-haiku-4-5",
  heavy:      "claude-opus-4-8",
} as const;

const CODE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_file",
  "apply_patch",
  "bash",
]);

const SEARCH_TOOLS = new Set([
  "web_search",
  "browser",
  "fetch",
  "curl",
]);

// read_file is ambiguous — could be reviewing (planning) or prep for editing (coding).
// Don't switch on it. Let the model that's already active handle it.
const NEUTRAL_TOOLS = new Set([
  "read_file",
  "list_files",
  "grep",
]);

type Mode = "planning" | "coding" | "search" | "heavy";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// Within one agent run, a tool call may only switch to a mode of >= priority.
// Prevents parallel tool calls racing (e.g. bash + web_search in one turn)
// from non-deterministically downgrading coding → search.
const MODE_PRIORITY: Record<Mode, number> = {
  planning: 0,
  search:   1,
  coding:   2,
  heavy:    3,
};

// Thinking level co-routed with the model: planning/coding benefit from medium,
// search wants speed, heavy reasoning gets the full budget.
const MODE_THINKING: Record<Mode, ThinkingLevel> = {
  planning: "medium",
  coding:   "medium",
  search:   "low",
  heavy:    "high",
};

function labelFor(mode: Mode): string {
  switch (mode) {
    case "planning": return "Planning (Fable 5)";
    case "coding":   return "Coding (Sonnet 4.6)";
    case "search":   return "Search (Haiku 4.5)";
    case "heavy":    return "Heavy (Opus 4.8)";
  }
}

function modelFor(mode: Mode): string {
  switch (mode) {
    case "planning": return MODELS.planner;
    case "coding":   return MODELS.coder;
    case "search":   return MODELS.search;
    case "heavy":    return MODELS.heavy;
  }
}

function modeForModelId(modelId: string): Mode | undefined {
  switch (modelId) {
    case MODELS.planner: return "planning";
    case MODELS.coder:   return "coding";
    case MODELS.search:  return "search";
    case MODELS.heavy:   return "heavy";
    default:             return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let currentMode: Mode = "planning";
  let routingEnabled = true;
  // Minimum priority a tool-triggered switch must meet within the current agent run.
  let turnFloor = 0;
  // Per-session request counts, keyed by live model id (counted at turn_start).
  const requestsByModel = new Map<string, number>();

  function setBadge(ctx: any, text: string) {
    if (ctx?.ui) ctx.ui.setStatus("router", text);
  }

  function badgeText(mode: Mode): string {
    return routingEnabled ? labelFor(mode) : `⏸ ${labelFor(mode)}`;
  }

  // Reconcile against the LIVE model (ctx.model), not the internal currentMode var.
  // Mode/badge are only committed AFTER the model switch is confirmed, so the badge
  // can never claim a model that isn't actually active.
  // setModel needs a Model object from the registry — a bare string is a silent no-op.
  async function switchTo(mode: Mode, ctx?: any): Promise<boolean> {
    const modelId = modelFor(mode);

    // Already on the right model? Commit the mode label and re-align thinking.
    if (ctx?.model?.id === modelId) {
      currentMode = mode;
      setBadge(ctx, badgeText(mode));
      try { pi.setThinkingLevel(MODE_THINKING[mode]); } catch {}
      return true;
    }

    const model = ctx?.modelRegistry?.find(PROVIDER, modelId);
    if (!model) {
      ctx?.ui?.notify(`[router] model not found: ${PROVIDER}/${modelId}`, "error");
      return false;
    }
    try {
      const ok = await pi.setModel(model);
      if (!ok) {
        ctx?.ui?.notify(`[router] no API key for ${modelId}`, "error");
        return false;
      }
      // Switch confirmed — now commit mode, badge, and thinking level.
      currentMode = mode;
      setBadge(ctx, badgeText(mode));
      try { pi.setThinkingLevel(MODE_THINKING[mode]); } catch {}
      return true;
    } catch (err) {
      console.warn(`[router] switch to ${mode} failed:`, err);
      return false;
    }
  }

  // Tool-triggered switches respect the per-run priority floor.
  async function autoSwitchTo(mode: Mode, ctx?: any) {
    if (!routingEnabled) return;
    if (MODE_PRIORITY[mode] < turnFloor) return;
    if (await switchTo(mode, ctx)) {
      turnFloor = MODE_PRIORITY[mode];
    }
  }

  // Manual switches bypass the floor and set it.
  async function manualSwitchTo(mode: Mode, ctx: any, message: string) {
    if (await switchTo(mode, ctx)) {
      turnFloor = MODE_PRIORITY[mode];
      ctx.ui.notify(message, "info");
    }
  }

  // ── Keep state in sync with external model changes (/model, Ctrl+P) ──
  pi.on("model_select", async (event, ctx) => {
    const mode = modeForModelId(event.model?.id ?? "");
    if (mode) {
      currentMode = mode;
      setBadge(ctx, badgeText(mode));
    } else {
      // Model outside the routing table — show it honestly rather than lying.
      setBadge(ctx, `Manual (${event.model?.id ?? "unknown"})`);
    }
  });

  // ── Per-model request stats (one turn = one LLM request) ───────────
  pi.on("turn_start", async (_event, ctx) => {
    const id = ctx?.model?.id;
    if (id) requestsByModel.set(id, (requestsByModel.get(id) ?? 0) + 1);
  });

  // ── Tool starts → switch to the appropriate model ──────────────────
  pi.on("tool_call", async (event, ctx) => {
    const name = event.toolName ?? "";

    if (CODE_TOOLS.has(name)) {
      await autoSwitchTo("coding", ctx);
    } else if (SEARCH_TOOLS.has(name)) {
      await autoSwitchTo("search", ctx);
    }
    // NEUTRAL_TOOLS: do nothing, stay on current model
  });

  // ── Search done → return to planner for analysis ───────────────────
  pi.on("tool_result", async (event, ctx) => {
    const name = event.toolName ?? "";
    // Only step down if search actually "won" this run — if coding took
    // priority in parallel, stay on the coder.
    if (SEARCH_TOOLS.has(name) && currentMode === "search" && routingEnabled) {
      turnFloor = 0;
      await switchTo("planning", ctx);
    }
  });

  // ── New agent run → reset floor, start on the planner ──────────────
  pi.on("agent_start", async (_event, ctx) => {
    turnFloor = 0;
    if (!routingEnabled) return;
    // Each new user message starts fresh on the planner.
    // If the LLM needs to code, tool_call will swap it.
    await switchTo("planning", ctx);
  });

  // ── Manual overrides ───────────────────────────────────────────────
  pi.registerCommand("plan", {
    description: "Switch to Fable 5 (planning)",
    handler: async (_args, ctx) => {
      await manualSwitchTo("planning", ctx, "→ Fable 5 (planning)");
    },
  });

  pi.registerCommand("code", {
    description: "Switch to Sonnet 4.6 (coding)",
    handler: async (_args, ctx) => {
      await manualSwitchTo("coding", ctx, "→ Sonnet 4.6 (coding)");
    },
  });

  pi.registerCommand("search", {
    description: "Switch to Haiku 4.5 (search)",
    handler: async (_args, ctx) => {
      await manualSwitchTo("search", ctx, "→ Haiku 4.5 (search)");
    },
  });

  pi.registerCommand("opus", {
    description: "Switch to Opus 4.8 (heavy reasoning)",
    handler: async (_args, ctx) => {
      await manualSwitchTo("heavy", ctx, "→ Opus 4.8 (heavy reasoning)");
    },
  });

  // ── Pause / resume auto-routing ────────────────────────────────────
  pi.registerCommand("router-pause", {
    description: "Pause auto-routing (stay on current model; manual commands still work)",
    handler: async (_args, ctx) => {
      routingEnabled = false;
      setBadge(ctx, badgeText(currentMode));
      ctx.ui.notify("Router paused — staying on current model. /router-resume to re-enable.", "info");
    },
  });

  pi.registerCommand("router-resume", {
    description: "Resume auto-routing",
    handler: async (_args, ctx) => {
      routingEnabled = true;
      setBadge(ctx, badgeText(currentMode));
      ctx.ui.notify("Router resumed — auto-routing active.", "info");
    },
  });

  pi.registerCommand("router-status", {
    description: "Show current routing state",
    handler: async (_args, ctx) => {
      const liveId = ctx?.model?.id ?? "unknown";
      const intendedId = modelFor(currentMode);
      const drift = liveId !== intendedId ? `  ⚠ DRIFT — router intends ${intendedId}` : "";

      const total = [...requestsByModel.values()].reduce((a, b) => a + b, 0);
      const statsLines =
        total === 0
          ? ["  (no requests yet)"]
          : [...requestsByModel.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id, n]) => `  ${id.padEnd(22)} ${String(n).padStart(4)}  (${Math.round((n / total) * 100)}%)`);

      ctx.ui.notify(
        [
          `Live model: ${liveId}${drift}`,
          `Router mode: ${currentMode} (${routingEnabled ? "auto-routing ON" : "PAUSED"})`,
          ``,
          `Requests this session:`,
          ...statsLines,
          ``,
          `Auto-routing:`,
          `  write_file/edit_file/bash → Sonnet 4.6`,
          `  web_search/browser/fetch  → Haiku 4.5 (returns to Fable after)`,
          `  new message               → Fable 5 (planner)`,
          `  parallel tools            → higher priority wins (code > search)`,
          ``,
          `Manual: /plan /code /search /opus  •  /router-pause /router-resume`,
        ].join("\n"),
        "info"
      );
    },
  });

  // ── Startup ────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    await switchTo("planning", ctx);
  });
}
