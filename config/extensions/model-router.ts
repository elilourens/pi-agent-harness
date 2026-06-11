// model-router.ts — auto-routes models by tool use + tracks per-model cost.
// Plan→Fable 5, code→Sonnet 4.6, search→Haiku 4.5, heavy→Opus 4.8 (/opus only).
// Search returns to planner after; code sticks. Parallel tools: higher priority wins.
// Live cost badge in footer; /cost for full breakdown; /router-status for routing stats.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "anthropic";

type Mode = "planning" | "search" | "coding" | "heavy";

const MODE = {
  planning: { model: "claude-fable-5",    label: "Planning (Fable 5)",  thinking: "medium", priority: 0 },
  search:   { model: "claude-haiku-4-5",  label: "Search (Haiku 4.5)", thinking: "low",    priority: 1 },
  coding:   { model: "claude-sonnet-4-6", label: "Coding (Sonnet 4.6)", thinking: "medium", priority: 2 },
  heavy:    { model: "claude-opus-4-8",   label: "Heavy (Opus 4.8)",   thinking: "high",   priority: 3 },
} as const;

const CODE_TOOLS   = new Set(["write_file", "edit_file", "create_file", "apply_patch", "bash"]);
const SEARCH_TOOLS = new Set(["web_search", "browser", "fetch", "curl"]);
// read_file/grep are ambiguous — never switch on them.

// Cost accumulated per model id over the session.
type Cost = { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
const ZERO_COST = (): Cost => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

const fmt  = (n: number) => `$${n.toFixed(4)}`;
const add  = (a: Cost, b: Partial<Cost>): Cost => ({
  input:      a.input      + (b.input      ?? 0),
  output:     a.output     + (b.output     ?? 0),
  cacheRead:  a.cacheRead  + (b.cacheRead  ?? 0),
  cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
  total:      a.total      + (b.total      ?? 0),
});

export default function (pi: ExtensionAPI) {
  // ── Router state ─────────────────────────────────────────────────────
  let mode: Mode = "planning";
  let enabled = true;
  let floor = 0; // min priority for auto-switches within one agent run
  const requests = new Map<string, number>();

  // ── Cost state ───────────────────────────────────────────────────────
  const costs = new Map<string, Cost>(); // model id → accumulated cost
  const totalCost = () => [...costs.values()].reduce((s, c) => s + c.total, 0);

  // ── UI helpers ────────────────────────────────────────────────────────
  const setBadge  = (ctx: any) => ctx?.ui?.setStatus("router", (enabled ? "" : "⏸ ") + MODE[mode].label);
  const setCostBadge = (ctx: any) => {
    const t = totalCost();
    ctx?.ui?.setStatus("cost", t > 0 ? `💰 ${fmt(t)}` : undefined);
  };

  // ── Model switching ───────────────────────────────────────────────────
  // Commit mode/badge only after the model switch is confirmed.
  async function switchTo(m: Mode, ctx?: any): Promise<boolean> {
    const { model: id, thinking } = MODE[m];
    if (ctx?.model?.id !== id) {
      const model = ctx?.modelRegistry?.find(PROVIDER, id);
      if (!model) return ctx?.ui?.notify(`[router] model not found: ${PROVIDER}/${id}`, "error"), false;
      try {
        if (!(await pi.setModel(model))) return ctx?.ui?.notify(`[router] no API key for ${id}`, "error"), false;
      } catch (err) { console.warn(`[router] switch to ${m} failed:`, err); return false; }
    }
    mode = m;
    setBadge(ctx);
    try { pi.setThinkingLevel(thinking); } catch {}
    return true;
  }

  async function autoSwitch(m: Mode, ctx?: any) {
    if (enabled && MODE[m].priority >= floor && (await switchTo(m, ctx))) floor = MODE[m].priority;
  }

  async function manualSwitch(m: Mode, ctx: any, msg: string) {
    if (await switchTo(m, ctx)) { floor = MODE[m].priority; ctx.ui.notify(msg, "info"); }
  }

  // ── Events ────────────────────────────────────────────────────────────

  // Sync with external model changes (/model, Ctrl+P).
  pi.on("model_select", async (event, ctx) => {
    const id = event.model?.id ?? "";
    const m = (Object.keys(MODE) as Mode[]).find((k) => MODE[k].model === id);
    if (m) { mode = m; setBadge(ctx); }
    else ctx?.ui?.setStatus("router", `Manual (${id || "unknown"})`);
  });

  pi.on("turn_start", async (_e, ctx) => {
    const id = ctx?.model?.id;
    if (id) requests.set(id, (requests.get(id) ?? 0) + 1);
  });

  // Accumulate cost per model from each assistant message.
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const cost = (event.message as any).usage?.cost as Partial<Cost> | undefined;
    if (!cost) return;
    const id = ctx?.model?.id ?? "unknown";
    costs.set(id, add(costs.get(id) ?? ZERO_COST(), cost));
    setCostBadge(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    const name = event.toolName ?? "";
    if (CODE_TOOLS.has(name))   await autoSwitch("coding", ctx);
    else if (SEARCH_TOOLS.has(name)) await autoSwitch("search", ctx);
  });

  // Search done → back to planner (unless coding won this run).
  pi.on("tool_result", async (event, ctx) => {
    if (enabled && mode === "search" && SEARCH_TOOLS.has(event.toolName ?? "")) {
      floor = 0;
      await switchTo("planning", ctx);
    }
  });

  // Each new user message starts fresh on the planner.
  pi.on("agent_start", async (_e, ctx) => { floor = 0; if (enabled) await switchTo("planning", ctx); });

  pi.on("session_start", async (_e, ctx) => {
    await switchTo("planning", ctx);
    setCostBadge(ctx);
  });

  // ── Manual model commands ─────────────────────────────────────────────
  const modelCmds: [string, Mode, string][] = [
    ["plan",   "planning", "→ Fable 5 (planning)"],
    ["code",   "coding",   "→ Sonnet 4.6 (coding)"],
    ["search", "search",   "→ Haiku 4.5 (search)"],
    ["opus",   "heavy",    "→ Opus 4.8 (heavy reasoning)"],
  ];
  for (const [name, m, msg] of modelCmds)
    pi.registerCommand(name, {
      description: `Switch to ${MODE[m].label}`,
      handler: async (_a, ctx) => manualSwitch(m, ctx, msg),
    });

  // ── Router pause / resume ─────────────────────────────────────────────
  pi.registerCommand("router-pause", {
    description: "Pause auto-routing (manual commands still work)",
    handler: async (_a, ctx) => {
      enabled = false; setBadge(ctx);
      ctx.ui.notify("Router paused. /router-resume to re-enable.", "info");
    },
  });

  pi.registerCommand("router-resume", {
    description: "Resume auto-routing",
    handler: async (_a, ctx) => {
      enabled = true; setBadge(ctx);
      ctx.ui.notify("Router resumed.", "info");
    },
  });

  // ── Cost breakdown ────────────────────────────────────────────────────
  pi.registerCommand("cost", {
    description: "Show session cost breakdown by model",
    handler: async (_a, ctx) => {
      const total = totalCost();
      if (total === 0) return ctx.ui.notify("No costs recorded yet.", "info");

      // Cache reads cost 0.1× input price → savings vs paying full input = cacheRead × 9.
      const allCosts = [...costs.values()];
      const saved = allCosts.reduce((s, c) => s + c.cacheRead * 9, 0);
      const wouldHavePaid = total + saved;

      const rows = [...costs.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([id, c]) => [
          `  ${id.padEnd(22)}`,
          `total ${fmt(c.total).padStart(9)}`,
          `in ${fmt(c.input).padStart(9)}`,
          `out ${fmt(c.output).padStart(9)}`,
          `cache↓ ${fmt(c.cacheRead).padStart(8)}`,   // read (cheap)
          `cache↑ ${fmt(c.cacheWrite).padStart(8)}`,  // write (1.25×)
        ].join("  "));

      ctx.ui.notify(
        [
          `Session total:  ${fmt(total)}`,
          `Without cache:  ${fmt(wouldHavePaid)}`,
          `Cache savings:  ${fmt(saved)}  (${saved > 0 ? Math.round((saved / wouldHavePaid) * 100) : 0}% off)`,
          "",
          "By model (cache↓ = reads @ 0.1× | cache↑ = writes @ 1.25×):",
          ...rows,
        ].join("\n"),
        "info",
      );
    },
  });

  // ── Router status ─────────────────────────────────────────────────────
  pi.registerCommand("router-status", {
    description: "Show routing state and per-model request counts",
    handler: async (_a, ctx) => {
      const live = ctx?.model?.id ?? "unknown";
      const intended = MODE[mode].model;
      const total = [...requests.values()].reduce((a, b) => a + b, 0);
      const stats = total
        ? [...requests.entries()].sort((a, b) => b[1] - a[1])
            .map(([id, n]) => `  ${id.padEnd(22)} ${String(n).padStart(4)}  (${Math.round((n / total) * 100)}%)`)
        : ["  (no requests yet)"];
      ctx.ui.notify(
        [
          `Live model:  ${live}${live !== intended ? `  ⚠ DRIFT — router intends ${intended}` : ""}`,
          `Router mode: ${mode} (${enabled ? "auto-routing ON" : "PAUSED"})`,
          "", "Requests this session:", ...stats,
          "",
          "Routing rules:",
          "  write_file/edit_file/bash → Sonnet 4.6",
          "  web_search/browser/fetch  → Haiku 4.5 (returns to Fable after)",
          "  new message               → Fable 5",
          "  parallel tools            → higher priority wins (code > search)",
          "",
          "Manual: /plan /code /search /opus  •  /router-pause /router-resume",
          "Cost:   /cost",
        ].join("\n"),
        "info",
      );
    },
  });
}
