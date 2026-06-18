// orchestrate.ts — the conductor (pure Node, no Pi). The heart of the harness.
//
// Flow:
//   1. assert clean repo, capture base SHA, make a run dir.
//   2. for each of the 3 personas: build a byte-identical task + persona-specific
//      system prompt, create an isolated worktree.
//   3. fan out all 3 Claude Code implementers concurrently (a crash/timeout of one
//      does NOT abort the batch).
//   4. collect RESULT.json + authoritative git diff/files per agent.
//   5. run the judge over all collected agents.
//   6. write the full run record to run.json and return it.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CONFIG } from "./config.ts";
import { buildSubagentDefs, depthEnv } from "./caps.ts";
import { readResult } from "./result.ts";
import { spawnClaudeAgent } from "./spawn.ts";
import { runJudge, type CollectedAgent, type VerdictJson } from "./judge.ts";
import {
  assertCleanRepo,
  commitWorktree,
  createWorktree,
  diffWorktree,
  filesChanged,
  getBaseSha,
} from "./worktree.ts";

export interface DispatchEvent {
  agentId?: string;
  phase: string; // e.g. "setup" | "spawn" | "collect" | "judge" | "done" | "error"
  message: string;
}

export interface DispatchOpts {
  task: string;
  repoRoot: string;
  personasDir: string;
  onEvent?: (e: DispatchEvent) => void;
}

export interface RunRecord {
  runId: string;
  runDir: string;
  baseSha: string;
  task: string;
  agents: CollectedAgent[];
  judge: { verdictMarkdown: string; verdictJson: VerdictJson | null };
  totals: { cost: number; turns: number };
}

const log = (onEvent: DispatchOpts["onEvent"], e: DispatchEvent) => {
  try {
    onEvent?.(e);
  } catch {
    /* never let UI break the run */
  }
};

export async function dispatch(opts: DispatchOpts): Promise<RunRecord> {
  const { task, repoRoot, personasDir, onEvent } = opts;

  // 1. Preconditions + run dir.
  log(onEvent, { phase: "setup", message: "Checking repo is clean…" });
  await assertCleanRepo(repoRoot);
  const baseSha = await getBaseSha(repoRoot);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  // Artifacts (transcripts, meta, judge verdict, run.json) live inside the repo,
  // gitignored under .pi-dispatch/. These are NOT git worktrees, so nesting is fine.
  const runDir = join(repoRoot, CONFIG.runDirName, runId);
  const judgeDir = join(runDir, "judge");
  mkdirSync(judgeDir, { recursive: true });
  // The agent CHECKOUTS (git worktrees) live OUTSIDE the repo, in a sibling dir.
  // Best practice: never nest a worktree inside the main working tree, even if
  // gitignored — it creates untracked-content / nested-metadata confusion.
  const worktreeRoot = join(dirname(repoRoot), `.${basename(repoRoot)}-worktrees`, runId);
  mkdirSync(worktreeRoot, { recursive: true });
  log(onEvent, {
    phase: "setup",
    message: `Run ${runId} → ${runDir} (base ${baseSha.slice(0, 8)}); worktrees → ${worktreeRoot}`,
  });

  // Shared output-contract text, appended to every persona.
  const contract = await readFile(join(personasDir, "output-contract.md"), "utf8");

  // 2 + 3. Build + fan out all personas concurrently. Top-level implementers run at depth 1.
  const TOP_DEPTH = 1;

  const runOne = async (
    persona: (typeof CONFIG.personas)[number],
  ): Promise<CollectedAgent> => {
    const agentDir = join(runDir, persona.id); // artifacts (inside repo, gitignored)
    const worktreePath = join(worktreeRoot, persona.id); // checkout (sibling dir, outside repo)
    mkdirSync(agentDir, { recursive: true });

    log(onEvent, { agentId: persona.id, phase: "setup", message: "Creating worktree…" });
    try {
      await createWorktree(repoRoot, persona.branch, baseSha, worktreePath);
    } catch (err) {
      // Worktree couldn't be made → this agent is a failure, but the batch continues.
      log(onEvent, {
        agentId: persona.id,
        phase: "error",
        message: `worktree failed: ${(err as Error).message}`,
      });
      return {
        id: persona.id,
        branch: persona.branch,
        worktreePath,
        status: "failed",
        result: null,
        diff: "",
        filesChanged: [],
        usage: { cost: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 },
        exitCode: null,
        stderr: `worktree setup failed: ${(err as Error).message}`,
      };
    }

    const personaBody = await readFile(join(personasDir, persona.file), "utf8");
    const appendSystemPrompt = personaBody + "\n\n" + contract;
    const agentsJson = buildSubagentDefs(persona, personaBody, TOP_DEPTH, CONFIG);

    // Persist raw transcript lines for later inspection.
    const transcriptPath = join(agentDir, "transcript.jsonl");
    const transcriptLines: string[] = [];

    log(onEvent, { agentId: persona.id, phase: "spawn", message: "Implementer running…" });
    const res = await spawnClaudeAgent({
      task, // BYTE-IDENTICAL across all three
      appendSystemPrompt,
      model: CONFIG.model,
      cwd: worktreePath,
      allowedTools: CONFIG.allowedTools,
      agentsJson,
      maxTurns: CONFIG.maxTurns,
      wallClockMs: CONFIG.wallClockMs,
      env: { ...process.env, ...depthEnv(TOP_DEPTH) },
      onEvent: (evt) => {
        try {
          transcriptLines.push(JSON.stringify(evt));
        } catch {
          /* ignore unserializable */
        }
        log(onEvent, {
          agentId: persona.id,
          phase: "spawn",
          message: evt?.type === "result" ? "implementer finished" : `event: ${evt?.type ?? "?"}`,
        });
      },
    });

    writeFileSync(transcriptPath, transcriptLines.join("\n") + "\n", "utf8");
    writeFileSync(
      join(agentDir, "meta.json"),
      JSON.stringify(
        {
          id: persona.id,
          branch: persona.branch,
          exitCode: res.exitCode,
          timedOut: res.timedOut,
          durationMs: res.durationMs,
          usage: res.usage,
          stderr: res.stderr,
        },
        null,
        2,
      ),
      "utf8",
    );

    // 4. Collect: commit the agent's work onto its branch (captures untracked
    // files too, and makes the branch promotable), then take an authoritative git
    // diff/files + the (untrusted) RESULT.json.
    log(onEvent, { agentId: persona.id, phase: "collect", message: "Committing work + collecting diff…" });
    try {
      const committed = await commitWorktree(worktreePath, `dispatch(${persona.id}): ${task.slice(0, 72)}`);
      if (!committed)
        log(onEvent, { agentId: persona.id, phase: "collect", message: "no changes to commit" });
    } catch (err) {
      log(onEvent, { agentId: persona.id, phase: "error", message: `commit failed: ${(err as Error).message}` });
    }
    const diff = await diffWorktree(repoRoot, worktreePath, baseSha);
    const changed = await filesChanged(worktreePath, baseSha);
    const rr = readResult(worktreePath);

    // status: a clean exit AND a valid RESULT.json. Timeout / nonzero / missing result → failed.
    const ok = res.exitCode === 0 && !res.timedOut && rr.ok;
    if (!ok && rr.ok === false) {
      log(onEvent, {
        agentId: persona.id,
        phase: "collect",
        message: `RESULT.json issue: ${rr.error}`,
      });
    }

    return {
      id: persona.id,
      branch: persona.branch,
      worktreePath,
      status: ok ? "ok" : "failed",
      result: rr.ok ? rr.value : null,
      diff,
      filesChanged: changed,
      usage: res.usage,
      exitCode: res.exitCode,
      stderr: res.stderr,
    };
  };

  log(onEvent, { phase: "spawn", message: `Fanning out ${CONFIG.personas.length} implementers…` });
  // allSettled-style: each runOne already converts its own failure into a failed CollectedAgent,
  // so Promise.all here is safe — one agent's crash never rejects the batch.
  const agents = await Promise.all(CONFIG.personas.map(runOne));

  for (const a of agents)
    log(onEvent, {
      agentId: a.id,
      phase: "collect",
      message: `${a.status === "ok" ? "✓" : "✗"} ${a.filesChanged.length} files, ` +
        `$${a.usage.cost.toFixed(4)}, ${a.usage.turns} turns`,
    });

  // 5. Judge.
  log(onEvent, { phase: "judge", message: "Spawning judge to verify + score…" });
  const rubricText = await readFile(join(personasDir, "judge-rubric.md"), "utf8");
  const judge = await runJudge({
    task,
    agents,
    judgingDir: judgeDir,
    rubricText,
    config: CONFIG,
    onEvent: (evt) =>
      log(onEvent, {
        phase: "judge",
        message: evt?.type === "result" ? "judge finished" : `judge event: ${evt?.type ?? "?"}`,
      }),
  });

  // 6. Totals + persist record.
  const totals = agents.reduce(
    (acc, a) => ({ cost: acc.cost + a.usage.cost, turns: acc.turns + a.usage.turns }),
    { cost: judge.usage.cost, turns: judge.usage.turns },
  );

  const record: RunRecord = {
    runId,
    runDir,
    baseSha,
    task,
    agents,
    judge: { verdictMarkdown: judge.verdictMarkdown, verdictJson: judge.verdictJson },
    totals,
  };

  writeFileSync(join(runDir, "run.json"), JSON.stringify(record, null, 2), "utf8");
  log(onEvent, { phase: "done", message: `Done. Total $${totals.cost.toFixed(4)}, ${totals.turns} turns.` });

  return record;
}

// Re-exported convenience used by index.ts's /dispatch-synthesize (spawn a hybrid).
// Kept here so index.ts stays thin. Uses plain git for branch creation.
export async function gitCheckoutNewBranch(repoRoot: string, branch: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const c = spawn("git", ["checkout", "-b", branch], { cwd: repoRoot, stdio: "ignore" });
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git checkout -b ${branch} exited ${code}`))));
  });
}
