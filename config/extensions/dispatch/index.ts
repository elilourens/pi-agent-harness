// index.ts — the Pi extension (cockpit). Thin: all heavy logic lives in the core
// modules (orchestrate / spawn / judge / worktree).
//
// DEFAULT BEHAVIOR: a freeform prompt typed at the normal Pi input fans out to the
// THREE strategy agents (hustler/engineer/native) + judge — it does NOT run a normal
// single-agent LLM turn. This is done via the `input` event returning
// { action: "handled" }, which cancels Pi's normal turn before the agent loop runs.
//
// Escape hatch: /chat <prompt> runs a normal single-agent Pi turn (model-router applies).
// Toggle:       /dispatch-mode on|off  flips the default.
//
// Commands:
//   /dispatch <task>          — explicit fan-out (same as the default behavior).
//   /chat <prompt>            — normal single-agent Pi turn (bypass dispatch).
//   /dispatch-mode on|off     — freeform prompts dispatch (on) or run normal Pi (off).
//   /dispatch-promote <id>    — merge the chosen agent's branch into main.
//   /dispatch-synthesize      — spawn a hybrid from the last run's worktrees + verdict.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "./config.ts";
import { dispatch, gitCheckoutNewBranch, type RunRecord } from "./orchestrate.ts";
import { promoteBranch } from "./worktree.ts";
import { spawnClaudeAgent } from "./spawn.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  // Last run record, so /dispatch-promote and /dispatch-synthesize can act on it.
  let lastRun: RunRecord | null = null;
  // Whether freeform prompts fan out to 3 agents (true) or run normal Pi (false).
  let dispatchDefault = true;

  // Shared: run a dispatch, store it, and render summary + verdict via the UI.
  async function runDispatch(task: string, ctx: any) {
    ctx.ui.notify(`Dispatching 3 agents on: ${task}`, "info");
    const record = await dispatch({
      task,
      repoRoot: ctx.cwd,
      personasDir: HERE,
      onEvent: (e) =>
        ctx.ui.notify(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`, "info"),
    });
    lastRun = record;

    const summary = record.agents
      .map(
        (a) =>
          `${a.status === "ok" ? "✓" : "✗"} ${a.id} — ${a.filesChanged.length} files, ` +
          `$${a.usage.cost.toFixed(4)}, ${a.usage.turns} turns`,
      )
      .join("\n");

    ctx.ui.notify(
      [
        `Dispatch ${record.runId} complete.`,
        summary,
        `Totals: $${record.totals.cost.toFixed(4)} over ${record.totals.turns} turns.`,
        `Run dir: ${record.runDir}`,
      ].join("\n"),
      "info",
    );

    ctx.ui.notify(
      [
        "=== JUDGE VERDICT ===",
        record.judge.verdictMarkdown || "(judge produced no text output)",
        "",
        "Next: /dispatch-promote <agentId>  or  /dispatch-synthesize",
      ].join("\n"),
      "info",
    );
  }

  // ── DEFAULT: freeform prompt → 3-agent dispatch ──────────────────────────────
  // Returning { action: "handled" } cancels the normal LLM turn entirely.
  pi.on("input", async (event, ctx) => {
    // Never intercept messages our own commands inject (would loop on /chat).
    if (event.source === "extension") return { action: "continue" };
    // Toggled off → behave like normal Pi.
    if (!dispatchDefault) return { action: "continue" };
    const text = (event.text ?? "").trim();
    if (!text) return { action: "continue" };
    // Let slash-commands (/chat, /dispatch-promote, /opus, …) through untouched.
    if (text.startsWith("/")) return { action: "continue" };

    try {
      await runDispatch(text, ctx);
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

  // ── Explicit dispatch (same as the default behavior) ──────────────────────────
  pi.registerCommand("dispatch", {
    description: "Fan out 3 strategy agents (hustler/engineer/native) on one task, then judge them",
    handler: async (args: string, ctx: any) => {
      const task = (args ?? "").trim();
      if (!task)
        return ctx.ui.notify(
          "Usage: /dispatch <task>\nRuns 3 competing Claude Code agents in isolated git worktrees, then judges them.",
          "info",
        );
      try {
        await runDispatch(task, ctx);
      } catch (err) {
        ctx.ui.notify(`Dispatch failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("dispatch-promote", {
    description: "Merge a dispatched agent's branch into main (e.g. /dispatch-promote engineer)",
    handler: async (args: string, ctx: any) => {
      const id = (args ?? "").trim();
      if (!lastRun) return ctx.ui.notify("No dispatch run in this session. Run a task first.", "error");
      if (!id)
        return ctx.ui.notify(
          `Usage: /dispatch-promote <agentId>\nAvailable: ${lastRun.agents.map((a) => a.id).join(", ")}`,
          "info",
        );

      const agent = lastRun.agents.find((a) => a.id === id);
      if (!agent)
        return ctx.ui.notify(
          `Unknown agent "${id}". Available: ${lastRun.agents.map((a) => a.id).join(", ")}`,
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
    description: "Spawn an opus agent to synthesize a hybrid of the last run onto branch agent/synthesis",
    handler: async (_args: string, ctx: any) => {
      if (!lastRun) return ctx.ui.notify("No dispatch run in this session. Run a task first.", "error");

      const branch = "agent/synthesis";
      try {
        await gitCheckoutNewBranch(ctx.cwd, branch);

        const verdict = lastRun.judge.verdictMarkdown || "(no verdict text)";
        const briefing = [
          `You are synthesizing a HYBRID solution from ${lastRun.agents.length} competing attempts at this task:`,
          "",
          lastRun.task,
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
          addDirs: lastRun.agents.map((a) => a.worktreePath),
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
