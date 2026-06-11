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
 * After search tools finish, returns to Fable 5 for analysis.
 * After code tools finish, stays on Sonnet (coding is usually multi-step).
 * /plan resets back to Fable 5 when you're done coding.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
  let currentMode: Mode = "planning";

  function switchTo(mode: Mode, ctx?: any) {
    if (mode === currentMode) return;
    currentMode = mode;
    try {
      pi.setModel(modelFor(mode));
      if (ctx?.ui) ctx.ui.setStatus("router", labelFor(mode));
    } catch (err) {
      console.warn(`[router] switch to ${mode} failed:`, err);
    }
  }

  // ── Tool starts → switch to the appropriate model ──────────────────
  pi.on("tool_call", async (event, ctx) => {
    const name = event.toolName ?? "";

    if (CODE_TOOLS.has(name)) {
      switchTo("coding", ctx);
    } else if (SEARCH_TOOLS.has(name)) {
      switchTo("search", ctx);
    }
    // NEUTRAL_TOOLS: do nothing, stay on current model
  });

  // ── Search done → return to planner for analysis ───────────────────
  pi.on("tool_result", async (event, ctx) => {
    const name = event.toolName ?? "";
    if (SEARCH_TOOLS.has(name)) {
      switchTo("planning", ctx);
    }
  });

  // ── New agent turn with no prior mode → reset to planner ───────────
  pi.on("agent_start", async (_event, ctx) => {
    // Each new user message starts fresh on the planner.
    // If the LLM needs to code, tool_call will swap it.
    switchTo("planning", ctx);
  });

  // ── Manual overrides ───────────────────────────────────────────────
  pi.registerCommand("plan", {
    description: "Switch to Fable 5 (planning)",
    handler: async (_args, ctx) => {
      switchTo("planning", ctx);
      ctx.ui.notify("→ Fable 5 (planning)", "info");
    },
  });

  pi.registerCommand("code", {
    description: "Switch to Sonnet 4.6 (coding)",
    handler: async (_args, ctx) => {
      switchTo("coding", ctx);
      ctx.ui.notify("→ Sonnet 4.6 (coding)", "info");
    },
  });

  pi.registerCommand("search", {
    description: "Switch to Haiku 4.5 (search)",
    handler: async (_args, ctx) => {
      switchTo("search", ctx);
      ctx.ui.notify("→ Haiku 4.5 (search)", "info");
    },
  });

  pi.registerCommand("opus", {
    description: "Switch to Opus 4.8 (heavy reasoning)",
    handler: async (_args, ctx) => {
      switchTo("heavy", ctx);
      ctx.ui.notify("→ Opus 4.8 (heavy reasoning)", "info");
    },
  });

  pi.registerCommand("router-status", {
    description: "Show current routing state",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        [
          `Current: ${currentMode} → ${modelFor(currentMode)}`,
          ``,
          `Auto-routing:`,
          `  write_file/edit_file/bash → Sonnet 4.6`,
          `  web_search/browser/fetch  → Haiku 4.5 (returns to Fable after)`,
          `  new message               → Fable 5 (planner)`,
          ``,
          `Manual: /plan /code /search /opus`,
        ].join("\n"),
        "info"
      );
    },
  });

  // ── Startup ────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("router", labelFor("planning"));
  });
}
