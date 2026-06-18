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
  allFailed?: boolean; // build mode
  allViable?: boolean; // plan mode
}

// A planning-phase agent: it proposed a plan (its final assistant message), it did
// NOT touch the repo. No worktree, no diff, no RESULT.json.
export interface PlanAgent {
  id: string;
  status: "ok" | "failed";
  plan: string;
  usage: SpawnUsage;
  exitCode: number | null;
  stderr: string;
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

// ── PLAN MODE ────────────────────────────────────────────────────────────────
// Compare three PLANS (read-only). The judge gets the repo via --add-dir (so it can
// verify file paths/claims) and the three plans inlined in the briefing. It is
// read-only over the codebase; it writes verdict.json into its own cwd via Bash.

export interface PlanJudgeOpts {
  task: string;
  agents: PlanAgent[];
  judgingDir: string;
  rubricText: string;
  repoRoot: string;
  config: DispatchConfig;
  onEvent?: (evt: any) => void;
}

function buildPlanJudgeSystemPrompt(rubricText: string): string {
  return [
    rubricText,
    "",
    "=== PLAN-JUDGING PROTOCOL (strict) ===",
    "You are an impartial judge comparing competing PLANS for ONE identical task.",
    "Nothing has been implemented. The repository is provided to you via --add-dir;",
    "read it (Read/Grep/Glob/Bash) to verify each plan's file paths and claims.",
    "",
    "1. Read the repo to CHECK each plan: do the cited files/APIs exist? Is the approach",
    "   actually compatible with this codebase? Note misreads and invented paths.",
    "2. Score each plan 1–5 on EACH of the 6 rubric criteria.",
    "3. Apply the FEASIBILITY GATE: a plan that would not work CANNOT be recommended,",
    "   no matter how high its other scores. If NO plan is viable, say so plainly.",
    "4. Recommend EXACTLY ONE plan to implement, or none if all are unviable.",
    "",
    "OUTPUT (in this order), as your final message:",
    "  (a) A markdown comparison table: rows = plans by agent id, columns = the 6 criteria + Total.",
    "  (b) A short trade-off narrative (2–5 sentences), noting you verified paths/claims by reading the repo.",
    "  (c) A recommendation: which plan to implement, with reasoning — or that none are viable.",
    "  (d) The literal line: Pick one to implement on main: /dispatch-pick <id>  (or refine and re-run)",
    "",
    "ALSO write a file named verdict.json in your CURRENT working directory (use Bash, e.g.",
    "a heredoc to `cat > verdict.json`) with this exact shape:",
    '  { "scores": { "<agentId>": { "feasibility": n, "completeness": n, "maintainability": n,',
    '    "risk": n, "simplicity": n, "effort_cost": n, "total": n }, ... },',
    '    "recommendation": "<agentId>" | null, "rationale": "<one paragraph>", "allViable": true|false }',
    "Use the EXACT criteria keys shown. Write verdict.json BEFORE finishing.",
  ].join("\n");
}

function briefPlanAgent(a: PlanAgent): string {
  const lines = [
    `### Plan from agent: ${a.id}  (status ${a.status})`,
    `Cost/turns: $${a.usage.cost.toFixed(4)} over ${a.usage.turns} turns.`,
  ];
  if (a.status === "ok" && a.plan.trim()) {
    lines.push("", a.plan.trim());
  } else {
    lines.push(
      `Exit code: ${a.exitCode}${a.stderr ? `  | stderr (tail): ${a.stderr.slice(-500)}` : ""}`,
      `THIS AGENT PRODUCED NO USABLE PLAN — treat it as a failed/unviable submission.`,
    );
  }
  return lines.join("\n");
}

export async function runPlanJudge(opts: PlanJudgeOpts): Promise<JudgeOutcome> {
  const briefing = [
    `TASK GIVEN TO ALL AGENTS (byte-identical):`,
    opts.task,
    "",
    `There are ${opts.agents.length} competing PLANS below (inlined). The repository is at`,
    `${opts.repoRoot} and is passed to you via --add-dir; read it to verify each plan's claims.`,
    "",
    ...opts.agents.map(briefPlanAgent),
    "",
    `Now follow the PLAN-JUDGING PROTOCOL in your system prompt: verify against the repo,`,
    `score, gate, output, and write verdict.json into your current working directory (${opts.judgingDir}).`,
  ].join("\n\n");

  const res = await spawnClaudeAgent({
    task: briefing,
    appendSystemPrompt: buildPlanJudgeSystemPrompt(opts.rubricText),
    model: opts.config.judgeModel,
    cwd: opts.judgingDir,
    allowedTools: opts.config.judgeAllowedTools,
    addDirs: [opts.repoRoot],
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
