// judge.ts — judge mode. Spawns a Claude Code judge that independently VERIFIES
// each agent's solution (by running its tests inside its worktree), scores all
// agents on the 7 rubric criteria, applies the correctness gate, and emits both a
// human verdict (markdown) and a machine verdict (verdict.json).
//
// Pure Node, no Pi.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DispatchConfig } from "./config.ts";
import type { AgentResult } from "./result.ts";
import { spawnClaudeAgent, type SpawnUsage } from "./spawn.ts";

export interface CollectedAgent {
  id: string;
  branch: string;
  worktreePath: string;
  status: "ok" | "failed";
  result: AgentResult | null;
  diff: string;
  filesChanged: string[];
  usage: SpawnUsage;
  exitCode: number | null;
  stderr: string;
}

export interface VerdictJson {
  scores: Record<string, Record<string, number> & { total?: number }>;
  recommendation: string | null;
  rationale: string;
  allFailed: boolean;
}

export interface JudgeOpts {
  task: string;
  agents: CollectedAgent[];
  judgingDir: string;
  rubricText: string;
  config: DispatchConfig;
  onEvent?: (evt: any) => void;
}

export interface JudgeOutcome {
  verdictMarkdown: string;
  verdictJson: VerdictJson | null;
  usage: SpawnUsage;
}

// Compact per-agent briefing. We deliberately do NOT inline the full diffs — the
// judge is told to read diffs/files itself from the provided worktrees.
function briefAgent(a: CollectedAgent): string {
  const r = a.result;
  const lines = [
    `### Agent: ${a.id}  (branch ${a.branch}, status ${a.status})`,
    `Worktree (read its files/diff yourself): ${a.worktreePath}`,
    `Exit code: ${a.exitCode}${a.stderr ? `  | stderr (tail): ${a.stderr.slice(-500)}` : ""}`,
    `Cost/turns: $${a.usage.cost.toFixed(4)} over ${a.usage.turns} turns ` +
      `(in ${a.usage.inputTokens} / out ${a.usage.outputTokens} tok; cache r ${a.usage.cacheRead} / w ${a.usage.cacheWrite}).`,
    `Files changed (per git, authoritative): ${a.filesChanged.length ? a.filesChanged.join(", ") : "(none)"}`,
  ];
  if (r) {
    lines.push(
      `Approach: ${r.approach_summary}`,
      `Self-claimed how_to_run: ${JSON.stringify(r.how_to_run)}`,
      `Self-claimed tests: ${r.tests}`,
      `Self-claimed known_risks: ${JSON.stringify(r.known_risks)}`,
      `Self-estimate: ${JSON.stringify(r.self_estimate)}`,
    );
  } else {
    lines.push(`RESULT.json MISSING or INVALID — treat as a failed/incomplete submission.`);
  }
  return lines.join("\n");
}

function buildJudgeSystemPrompt(rubricText: string): string {
  return [
    rubricText,
    "",
    "=== JUDGING PROTOCOL (strict) ===",
    "You are an impartial judge comparing competing solutions to ONE identical task.",
    "Each agent worked in its own git worktree, provided to you via --add-dir. You can",
    "read every file and run any command inside those worktrees with Bash.",
    "",
    "1. INDEPENDENTLY VERIFY correctness: for each agent, cd into its worktree and actually",
    "   run its how_to_run commands and tests. Do NOT trust the agent's self-reported test",
    "   output — re-run it. Note any mismatch between claimed and actual results (this feeds Honesty).",
    "2. Score each agent 1–5 on EACH of the 7 rubric criteria.",
    "3. Apply the CORRECTNESS GATE: a solution that does not actually work CANNOT place first,",
    "   no matter how high its other scores. If ALL agents fail, say so plainly — do not crown a",
    "   least-bad 'winner' as if it works.",
    "4. Account for Effort/cost as the SUM across the agent and any subagents it spawned — an",
    "   agent cannot hide work in children.",
    "",
    "OUTPUT (in this order), as your final message:",
    "  (a) A markdown comparison table: rows = agents, columns = the 7 criteria + Total.",
    "  (b) A short trade-off narrative (2–5 sentences).",
    "  (c) A recommendation: which branch to promote, with reasoning — or 'none' if all failed.",
    "  (d) An offer: promote one branch (/dispatch-promote <id>) or synthesize a hybrid (/dispatch-synthesize).",
    "",
    "ALSO write a file named verdict.json in your CURRENT working directory with this exact shape:",
    '  { "scores": { "<agentId>": { "correctness": n, "completeness": n, "maintainability": n,',
    '    "security": n, "simplicity": n, "effort_cost": n, "honesty": n, "total": n }, ... },',
    '    "recommendation": "<agentId>" | null, "rationale": "<one paragraph>", "allFailed": true|false }',
    "Use the EXACT criteria keys shown. Write verdict.json BEFORE finishing.",
  ].join("\n");
}

function readVerdictJson(judgingDir: string): VerdictJson | null {
  try {
    const raw = readFileSync(join(judgingDir, "verdict.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.scores) return parsed as VerdictJson;
    return null;
  } catch {
    return null;
  }
}

export async function runJudge(opts: JudgeOpts): Promise<JudgeOutcome> {
  const briefing = [
    `TASK GIVEN TO ALL AGENTS (byte-identical):`,
    opts.task,
    "",
    `There are ${opts.agents.length} competing submissions. Their worktree paths are passed`,
    `to you via --add-dir; read the diffs/files there yourself. Briefings:`,
    "",
    ...opts.agents.map(briefAgent),
    "",
    `Now follow the JUDGING PROTOCOL in your system prompt: verify, score, gate, output, and`,
    `write verdict.json into your current working directory (${opts.judgingDir}).`,
  ].join("\n\n");

  const res = await spawnClaudeAgent({
    task: briefing,
    appendSystemPrompt: buildJudgeSystemPrompt(opts.rubricText),
    model: opts.config.judgeModel,
    cwd: opts.judgingDir,
    allowedTools: opts.config.judgeAllowedTools,
    addDirs: opts.agents.map((a) => a.worktreePath),
    maxTurns: 60,
    wallClockMs: opts.config.wallClockMs,
    onEvent: opts.onEvent,
  });

  return {
    verdictMarkdown: res.resultText,
    verdictJson: readVerdictJson(opts.judgingDir),
    usage: res.usage,
  };
}
