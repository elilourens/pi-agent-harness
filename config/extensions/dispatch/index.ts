// index.ts — the Pi extension (cockpit). Thin: all heavy logic lives in the core
// modules (orchestrate / spawn / judge / worktree).
//
// DEFAULT BEHAVIOR (PLAN MODE): a freeform prompt typed at the normal Pi input fans
// out to the THREE strategy agents (hustler/engineer/native), which RESEARCH and
// PROPOSE a plan (read-only — they do NOT touch the repo) + a judge that recommends
// one plan. It does NOT run a normal single-agent LLM turn. This is done via the
// `input` event returning { action: "handled" }, which cancels Pi's normal turn.
//
// Then you /dispatch-pick <id> to implement the chosen plan directly on main.
//
// Escape hatch: /chat <prompt> runs a normal single-agent Pi turn (model-router applies).
// Toggle:       /dispatch-mode on|off  flips the default.
//
// Commands:
//   /dispatch <task>          — PLAN mode: 3 agents propose plans + judge (default behavior).
//   /dispatch-pick <id>       — implement the chosen plan on main.
//   /dispatch-build <task>    — BUILD mode: 3 agents implement in isolated worktrees + judge.
//   /chat <prompt>            — normal single-agent Pi turn (bypass dispatch).
//   /dispatch-mode on|off     — freeform prompts dispatch (on) or run normal Pi (off).
//   /dispatch-promote <id>    — (build mode) merge the chosen agent's branch into main.
//   /dispatch-synthesize      — (build mode) spawn a hybrid from the last build's worktrees + verdict.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "./config.ts";
import {
  dispatch,
  dispatchPlan,
  implementPlan,
  gitCheckoutNewBranch,
  type PlanRunRecord,
  type RunRecord,
} from "./orchestrate.ts";
import { promoteBranch } from "./worktree.ts";
import { spawnClaudeAgent } from "./spawn.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  // Last PLAN run (default mode), so /dispatch-pick can implement a chosen plan.
  let lastPlanRun: PlanRunRecord | null = null;
  // Last BUILD run, so /dispatch-promote and /dispatch-synthesize can act on it.
  let lastBuildRun: RunRecord | null = null;
  // Whether freeform prompts fan out to 3 agents (true) or run normal Pi (false).
  let dispatchDefault = true;

  // Shared: run a PLAN dispatch, store it, and render the plans + verdict via the UI.
  async function runPlanDispatch(task: string, ctx: any) {
    ctx.ui.notify(`Planning with 3 agents on: ${task}`, "info");
    const record = await dispatchPlan({
      task,
      repoRoot: ctx.cwd,
      personasDir: HERE,
      onEvent: (e) =>
        ctx.ui.notify(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`, "info"),
    });
    lastPlanRun = record;

    // Each agent's full plan, with a header.
    for (const a of record.agents) {
      ctx.ui.notify(
        [
          `=== PLAN: ${a.id} (${a.status === "ok" ? "✓" : "✗ failed"}) — ` +
            `$${a.usage.cost.toFixed(4)}, ${a.usage.turns} turns ===`,
          a.status === "ok" && a.plan ? a.plan : "(no plan produced)",
        ].join("\n"),
        "info",
      );
    }

    ctx.ui.notify(
      [
        `Plan run ${record.runId} complete. Totals: $${record.totals.cost.toFixed(4)} over ${record.totals.turns} turns.`,
        `Run dir: ${record.runDir}`,
        "",
        "=== JUDGE VERDICT ===",
        record.judge.verdictMarkdown || "(judge produced no text output)",
        "",
        `Pick one to implement on main: /dispatch-pick <id>  (available: ${record.agents.map((a) => a.id).join(", ")})`,
      ].join("\n"),
      "info",
    );
  }

  // ── DEFAULT: freeform prompt → 3-agent PLAN dispatch ─────────────────────────
  // Returning { action: "handled" } cancels the normal LLM turn entirely.
  pi.on("input", async (event, ctx) => {
    // Never intercept messages our own commands inject (would loop on /chat).
    if (event.source === "extension") return { action: "continue" };
    // Toggled off → behave like normal Pi.
    if (!dispatchDefault) return { action: "continue" };
    const text = (event.text ?? "").trim();
    if (!text) return { action: "continue" };
    // Let slash-commands (/chat, /dispatch-pick, /opus, …) through untouched.
    if (text.startsWith("/")) return { action: "continue" };

    try {
      await runPlanDispatch(text, ctx);
    } catch (err) {
      ctx.ui.notify(
        `Dispatch failed: ${(err as Error).message}\n` +
          `(Use /chat <prompt> for a normal turn, or /dispatch-mode off to disable dispatch-by-default.)`,
        "error",
      );
    }
    return { action: "handled" };
  });

  // ── Escape hatch: a normal single-agent Pi turn (model-router applies) ────────
  pi.registerCommand("chat", {
    description: "Run a normal single-agent Pi turn (bypass dispatch-by-default)",
    handler: async (args: string, ctx: any) => {
      const text = (args ?? "").trim();
      if (!text) return ctx.ui.notify("Usage: /chat <prompt>", "info");
      // sendUserMessage always triggers a real turn; gate on idle for delivery mode.
      if (ctx.isIdle?.()) pi.sendUserMessage(text);
      else pi.sendUserMessage(text, { deliverAs: "steer" });
    },
  });

  // ── Toggle dispatch-by-default ────────────────────────────────────────────────
  pi.registerCommand("dispatch-mode", {
    description: "Toggle whether freeform prompts dispatch 3 agents (on) or run normal Pi (off)",
    handler: async (args: string, ctx: any) => {
      const a = (args ?? "").trim().toLowerCase();
      if (a === "on") dispatchDefault = true;
      else if (a === "off") dispatchDefault = false;
      else
        return ctx.ui.notify(
          `Dispatch-as-default is currently ${dispatchDefault ? "ON" : "OFF"}.\nUsage: /dispatch-mode on|off`,
          "info",
        );
      ctx.ui.notify(
        dispatchDefault
          ? "Dispatch-as-default ON — freeform prompts fan out to 3 agents. (/chat for a normal turn.)"
          : "Dispatch-as-default OFF — freeform prompts run normal Pi. (/dispatch <task> to fan out.)",
        "info",
      );
    },
  });

  // ── Explicit PLAN dispatch (same as the default behavior) ─────────────────────
  pi.registerCommand("dispatch", {
    description: "PLAN mode: 3 strategy agents (hustler/engineer/native) propose plans (read-only), then judge them",
    handler: async (args: string, ctx: any) => {
      const task = (args ?? "").trim();
      if (!task)
        return ctx.ui.notify(
          "Usage: /dispatch <task>\nRuns 3 competing agents that RESEARCH and PROPOSE plans (no code changes), then judges them.\nThen: /dispatch-pick <id> to implement the chosen plan on main.",
          "info",
        );
      try {
        await runPlanDispatch(task, ctx);
      } catch (err) {
        ctx.ui.notify(`Dispatch failed: ${(err as Error).message}`, "error");
      }
    },
  });

  // ── PICK & IMPLEMENT a plan on main ───────────────────────────────────────────
  pi.registerCommand("dispatch-pick", {
    description: "Implement a proposed plan on main (e.g. /dispatch-pick engineer)",
    handler: async (args: string, ctx: any) => {
      const id = (args ?? "").trim();
      if (!lastPlanRun) return ctx.ui.notify("Run a task first to get plans.", "error");
      if (!id)
        return ctx.ui.notify(
          `Usage: /dispatch-pick <id>\nAvailable: ${lastPlanRun.agents.map((a) => a.id).join(", ")}`,
          "info",
        );

      const agent = lastPlanRun.agents.find((a) => a.id === id);
      if (!agent)
        return ctx.ui.notify(
          `Unknown plan "${id}". Available: ${lastPlanRun.agents.map((a) => a.id).join(", ")}`,
          "error",
        );
      if (agent.status !== "ok" || !agent.plan.trim())
        return ctx.ui.notify(`Plan "${id}" failed or is empty — pick another.`, "error");

      try {
        ctx.ui.notify(`Implementing the '${id}' plan on main…`, "info");
        const res = await implementPlan({
          repoRoot: ctx.cwd,
          personasDir: HERE,
          agentId: id,
          plan: agent.plan,
          task: lastPlanRun.task,
          onEvent: (e) =>
            ctx.ui.notify(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`, "info"),
        });

        ctx.ui.notify(
          [
            `Implementation ${res.timedOut ? "TIMED OUT" : res.exitCode === 0 ? "complete" : `exited ${res.exitCode}`} ` +
              `($${res.usage.cost.toFixed(4)}, ${res.usage.turns} turns).`,
            res.resultText ? `\n${res.resultText}` : "",
            "",
            "Review with `git diff`; keep it or `git checkout .` to discard.",
          ].join("\n"),
          res.exitCode === 0 && !res.timedOut ? "info" : "error",
        );
      } catch (err) {
        ctx.ui.notify(`Implement failed: ${(err as Error).message}`, "error");
      }
    },
  });

  // ── BUILD mode: the OLD competitive-implementation flow (worktrees + judge) ────
  pi.registerCommand("dispatch-build", {
    description: "BUILD mode: 3 agents IMPLEMENT in isolated git worktrees, then judge them",
    handler: async (args: string, ctx: any) => {
      const task = (args ?? "").trim();
      if (!task)
        return ctx.ui.notify(
          "Usage: /dispatch-build <task>\nRuns 3 competing Claude Code agents in isolated git worktrees, then judges them.\nThen: /dispatch-promote <id> or /dispatch-synthesize.",
          "info",
        );
      try {
        ctx.ui.notify(`Building with 3 agents on: ${task}`, "info");
        const record = await dispatch({
          task,
          repoRoot: ctx.cwd,
          personasDir: HERE,
          onEvent: (e) =>
            ctx.ui.notify(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`, "info"),
        });
        lastBuildRun = record;

        const summary = record.agents
          .map(
            (a) =>
              `${a.status === "ok" ? "✓" : "✗"} ${a.id} — ${a.filesChanged.length} files, ` +
              `$${a.usage.cost.toFixed(4)}, ${a.usage.turns} turns`,
          )
          .join("\n");

        ctx.ui.notify(
          [
            `Build ${record.runId} complete.`,
            summary,
            `Totals: $${record.totals.cost.toFixed(4)} over ${record.totals.turns} turns.`,
            `Run dir: ${record.runDir}`,
            "",
            "=== JUDGE VERDICT ===",
            record.judge.verdictMarkdown || "(judge produced no text output)",
            "",
            "Next: /dispatch-promote <agentId>  or  /dispatch-synthesize",
          ].join("\n"),
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`Build failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("dispatch-promote", {
    description: "(build mode) Merge a built agent's branch into main (e.g. /dispatch-promote engineer)",
    handler: async (args: string, ctx: any) => {
      const id = (args ?? "").trim();
      if (!lastBuildRun) return ctx.ui.notify("No build run in this session. Run /dispatch-build first.", "error");
      if (!id)
        return ctx.ui.notify(
          `Usage: /dispatch-promote <agentId>\nAvailable: ${lastBuildRun.agents.map((a) => a.id).join(", ")}`,
          "info",
        );

      const agent = lastBuildRun.agents.find((a) => a.id === id);
      if (!agent)
        return ctx.ui.notify(
          `Unknown agent "${id}". Available: ${lastBuildRun.agents.map((a) => a.id).join(", ")}`,
          "error",
        );

      try {
        await promoteBranch(ctx.cwd, agent.branch);
        ctx.ui.notify(`Promoted ${agent.branch} into main (merge --no-ff).`, "info");
      } catch (err) {
        ctx.ui.notify(`Promote failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("dispatch-synthesize", {
    description: "(build mode) Spawn an opus agent to synthesize a hybrid of the last build onto branch agent/synthesis",
    handler: async (_args: string, ctx: any) => {
      if (!lastBuildRun) return ctx.ui.notify("No build run in this session. Run /dispatch-build first.", "error");

      const branch = "agent/synthesis";
      try {
        await gitCheckoutNewBranch(ctx.cwd, branch);

        const verdict = lastBuildRun.judge.verdictMarkdown || "(no verdict text)";
        const briefing = [
          `You are synthesizing a HYBRID solution from ${lastBuildRun.agents.length} competing attempts at this task:`,
          "",
          lastBuildRun.task,
          "",
          "The judge's verdict comparing the attempts:",
          verdict,
          "",
          "Each attempt's worktree is provided via --add-dir. Read their diffs/files, take the",
          "best parts of each, and implement a single coherent hybrid solution HERE in the current",
          `working directory (branch ${branch}). Finish by writing RESULT.json (same contract as the agents).`,
        ].join("\n");

        ctx.ui.notify(`Synthesizing hybrid on ${branch}…`, "info");
        const res = await spawnClaudeAgent({
          task: briefing,
          appendSystemPrompt:
            "You are a senior engineer producing the best possible merge of several competing solutions. Be pragmatic and correct.",
          model: CONFIG.model,
          cwd: ctx.cwd,
          allowedTools: CONFIG.allowedTools,
          addDirs: lastBuildRun.agents.map((a) => a.worktreePath),
          maxTurns: CONFIG.maxTurns,
          wallClockMs: CONFIG.wallClockMs,
          onEvent: (evt) =>
            ctx.ui.notify(
              `[synthesize] ${evt?.type === "result" ? "finished" : `event: ${evt?.type ?? "?"}`}`,
              "info",
            ),
        });

        ctx.ui.notify(
          [
            `Synthesis ${res.timedOut ? "TIMED OUT" : res.exitCode === 0 ? "complete" : `exited ${res.exitCode}`} on ${branch}.`,
            `Cost $${res.usage.cost.toFixed(4)}, ${res.usage.turns} turns.`,
            res.resultText ? `\n${res.resultText}` : "",
          ].join("\n"),
          res.exitCode === 0 && !res.timedOut ? "info" : "error",
        );
      } catch (err) {
        ctx.ui.notify(`Synthesize failed: ${(err as Error).message}`, "error");
      }
    },
  });
}
