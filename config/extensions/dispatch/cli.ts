#!/usr/bin/env node
// cli.ts — standalone entry point (no Pi). Mirrors the default PLAN flow:
//
//   node config/extensions/dispatch/cli.ts "redesign the homepage hero"      # plan (default)
//   node config/extensions/dispatch/cli.ts --pick engineer "<task>"          # plan, then implement that plan on main
//   node config/extensions/dispatch/cli.ts --build "<task>"                   # old build-all-three flow
//
// Resolves repoRoot via `git rev-parse --show-toplevel`; personasDir is this file's dir.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch, dispatchPlan, implementPlan } from "./orchestrate.ts";

const pexecFile = promisify(execFile);

async function repoRootOf(cwd: string): Promise<string> {
  const { stdout } = await pexecFile("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

async function main() {
  const argv = process.argv.slice(2);
  let mode: "plan" | "build" = "plan";
  let pickId: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--build") mode = "build";
    else if (argv[i] === "--pick") pickId = argv[++i] ?? null;
    else rest.push(argv[i]);
  }
  const task = rest.join(" ").trim();
  if (!task) {
    console.error('Usage: node cli.ts [--build | --pick <id>] "<task description>"');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = await repoRootOf(process.cwd());
  const log = (e: { phase: string; agentId?: string; message: string }) =>
    console.log(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`);

  console.log(`[dispatch] repo: ${repoRoot}`);
  console.log(`[dispatch] mode: ${mode}${pickId ? ` (auto-pick ${pickId})` : ""}`);
  console.log(`[dispatch] task: ${task}\n`);

  try {
    if (mode === "build") {
      const record = await dispatch({ task, repoRoot, personasDir: here, onEvent: log });
      console.log(`\n=== BUILD RUN ${record.runId} === (run dir: ${record.runDir})`);
      for (const a of record.agents)
        console.log(`${a.status === "ok" ? "✓" : "✗"} ${a.id.padEnd(10)} branch=${a.branch} files=${a.filesChanged.length} $${a.usage.cost.toFixed(4)} turns=${a.usage.turns}`);
      console.log(`\nTotals: $${record.totals.cost.toFixed(4)} / ${record.totals.turns} turns\n\n=== JUDGE VERDICT ===\n`);
      console.log(record.judge.verdictMarkdown || "(no verdict)");
      console.log(`\nPromote: git merge --no-ff <agent/branch>  (or via Pi: /dispatch-promote <id>)`);
      return;
    }

    // PLAN (default)
    const record = await dispatchPlan({ task, repoRoot, personasDir: here, onEvent: log });
    console.log(`\n=== PLAN RUN ${record.runId} === (run dir: ${record.runDir})\n`);
    for (const a of record.agents) {
      console.log(`\n================= PLAN: ${a.id} (${a.status === "ok" ? "✓" : "✗ failed"}) — $${a.usage.cost.toFixed(4)}, ${a.usage.turns} turns =================`);
      console.log(a.status === "ok" && a.plan ? a.plan : "(no plan produced)");
    }
    console.log(`\nTotals: $${record.totals.cost.toFixed(4)} / ${record.totals.turns} turns\n\n=== JUDGE VERDICT ===\n`);
    console.log(record.judge.verdictMarkdown || "(no verdict)");
    console.log(`\nAvailable to pick: ${record.agents.map((a) => a.id).join(", ")}`);

    if (pickId) {
      const chosen = record.agents.find((a) => a.id === pickId);
      if (!chosen || chosen.status !== "ok" || !chosen.plan) {
        console.error(`\n[pick] cannot implement "${pickId}" — no usable plan from that agent.`);
        process.exit(1);
      }
      console.log(`\n=== IMPLEMENTING '${pickId}' plan on main ===\n`);
      const impl = await implementPlan({ repoRoot, personasDir: here, agentId: pickId, plan: chosen.plan, task, onEvent: log });
      console.log(`\nImplement ${impl.timedOut ? "TIMED OUT" : impl.exitCode === 0 ? "complete" : `exited ${impl.exitCode}`} — $${impl.usage.cost.toFixed(4)}, ${impl.usage.turns} turns`);
      if (impl.resultText) console.log(`\n${impl.resultText}`);
      console.log(`\nReview with: git diff   (keep it, or 'git checkout .' to discard)`);
    } else {
      console.log(`\nTo implement one on main:  node cli.ts --pick <id> "<same task>"   (or in Pi: /dispatch-pick <id>)`);
    }
  } catch (err) {
    console.error(`\n[dispatch] FAILED: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Main-detection: run only when invoked directly, not when imported.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main();
}
