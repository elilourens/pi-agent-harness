#!/usr/bin/env node
// cli.ts — standalone entry point (no Pi). Run the dispatch harness from a shell:
//
//   node config/extensions/dispatch/cli.ts "implement X and add tests"
//   (or via tsx, given the repo is ESM + "type":"module")
//
// Resolves repoRoot via `git rev-parse --show-toplevel`; personasDir is this file's dir.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatch } from "./orchestrate.ts";

const pexecFile = promisify(execFile);

async function repoRootOf(cwd: string): Promise<string> {
  const { stdout } = await pexecFile("git", ["rev-parse", "--show-toplevel"], { cwd });
  return stdout.trim();
}

async function main() {
  const task = process.argv.slice(2).join(" ").trim();
  if (!task) {
    console.error('Usage: node cli.ts "<task description>"');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = await repoRootOf(process.cwd());

  console.log(`[dispatch] repo: ${repoRoot}`);
  console.log(`[dispatch] task: ${task}\n`);

  try {
    const record = await dispatch({
      task,
      repoRoot,
      personasDir: here,
      onEvent: (e) =>
        console.log(`[${e.phase}${e.agentId ? `:${e.agentId}` : ""}] ${e.message}`),
    });

    console.log(`\n=== RUN ${record.runId} ===`);
    console.log(`run dir: ${record.runDir}`);
    console.log(`base sha: ${record.baseSha}\n`);

    for (const a of record.agents) {
      console.log(
        `${a.status === "ok" ? "✓" : "✗"} ${a.id.padEnd(10)} ` +
          `branch=${a.branch}  files=${a.filesChanged.length}  ` +
          `$${a.usage.cost.toFixed(4)}  turns=${a.usage.turns}`,
      );
    }

    console.log(`\nTotals: $${record.totals.cost.toFixed(4)} over ${record.totals.turns} turns\n`);
    console.log("=== JUDGE VERDICT ===\n");
    console.log(record.judge.verdictMarkdown || "(judge produced no text output)");
    console.log(
      `\nPromote a branch:  git merge --no-ff <agent/branch>  (or via Pi: /dispatch-promote <id>)`,
    );
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
