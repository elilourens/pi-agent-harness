// index.ts — the Pi extension (cockpit). Thin: all heavy logic lives in the core
// modules (orchestrate / spawn / judge / worktree). Registers three commands:
//
//   /dispatch <task>          — fan out 3 strategy agents + judge them.
//   /dispatch-promote <id>    — merge the chosen agent's branch into main.
//   /dispatch-synthesize      — spawn a hybrid from the last run's worktrees + verdict.
//
// Matches the style/API of model-router.ts: pi.registerCommand(name,{description,handler}),
// ctx.ui.notify(msg,"info"|"error"), ctx.cwd.

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

  pi.registerCommand("dispatch", {
    description: "Fan out 3 strategy agents (hustler/engineer/native) on one task, then judge them",
    handler: async (args: string, ctx: any) => {
      const task = (args ?? "").trim();
      if (!task)
        return ctx.ui.notify(
          'Usage: /dispatch <task>\nRuns 3 competing Claude Code agents in isolated git worktrees, then judges them.',
          "info",
        );

      try {
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
      } catch (err) {
        ctx.ui.notify(`Dispatch failed: ${(err as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("dispatch-promote", {
    description: "Merge a dispatched agent's branch into main (e.g. /dispatch-promote engineer)",
    handler: async (args: string, ctx: any) => {
      const id = (args ?? "").trim();
      if (!lastRun) return ctx.ui.notify("No dispatch run in this session. Run /dispatch first.", "error");
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
      if (!lastRun) return ctx.ui.notify("No dispatch run in this session. Run /dispatch first.", "error");

      const branch = "agent/synthesis";
      try {
        // Create the synthesis branch off current HEAD (main).
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
