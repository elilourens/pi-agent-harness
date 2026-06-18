// config.ts — single source of truth for the dispatch harness tunables.
//
// HOW TO TUNE:
//   - Behavioural knobs (persona philosophy, judge rubric wording) live in the
//     adjacent .md files: personas/*.md, output-contract.md, judge-rubric.md.
//   - Numeric / structural knobs (models, caps, budgets, tool allowlists) live HERE.
//
// Caps honesty: depth is HARD (enforced by removing the "Agent" tool from the
// deepest subagents — see caps.ts). Fan-out and descendant counts are SOFT
// (stated in the persona prompt only); the CLI cannot truly enforce them.

export interface Persona {
  id: string;
  branch: string;
  file: string;
}

export interface DispatchConfig {
  model: string;
  judgeModel: string;
  personas: Persona[];
  maxDepth: number;
  maxFanout: number;
  maxDescendants: number;
  maxTurns: number;
  plannerMaxTurns: number;
  wallClockMs: number;
  allowedTools: string[];
  plannerTools: string[];
  implementerTools: string[];
  judgeAllowedTools: string[];
  runDirName: string;
  rubricWeights: Record<string, number>;
  claudeBin: string;
}

export const CONFIG: DispatchConfig = {
  // Implementer + judge models (claude CLI aliases: opus/sonnet/haiku/fable).
  model: "opus",
  judgeModel: "opus",

  // The three competing strategies. Each maps to a persona .md file + a branch.
  personas: [
    { id: "hustler", branch: "agent/hustler", file: "personas/hustler.md" },
    { id: "engineer", branch: "agent/engineer", file: "personas/engineer.md" },
    { id: "native", branch: "agent/native", file: "personas/native.md" },
  ],

  // Recursion caps. maxDepth is enforced hard via tool removal (caps.ts);
  // maxFanout / maxDescendants are soft (prompt-stated only).
  maxDepth: 2,
  maxFanout: 3,
  maxDescendants: 8,

  // Per-implementer budget.
  maxTurns: 40,
  // Per-planner budget (planning is read-only research, so it needs fewer turns).
  plannerMaxTurns: 25,
  wallClockMs: 1_200_000, // 20 min

  // Tools granted to build-mode implementers ("Agent" enables native subagents /
  // persona inheritance). Used by /dispatch-build + /dispatch-synthesize.
  allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "Agent"],

  // Planner tools are INTENTIONALLY read-only — NO Edit/Write/Bash — so a planning
  // agent physically cannot modify, create, or run anything in the repo. Plans are
  // research only; the plan is the planner's final assistant message.
  plannerTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],

  // Phase-2 implementer (the picked plan, applied directly on the working tree).
  implementerTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"],

  // Judge is READ-ONLY for the codebase: it reads the repo (--add-dir) and the
  // inlined plans, and runs Bash to verify claims/paths (and to write verdict.json
  // into its own cwd). No Edit/Write — it cannot mutate the repo.
  judgeAllowedTools: ["Read", "Grep", "Glob", "Bash"],

  runDirName: ".pi-dispatch",

  // The 7 rubric criteria. Weights default to 1. Correctness is a GATE (see judge-rubric.md):
  // a non-working solution cannot place first regardless of weighted total.
  rubricWeights: {
    correctness: 1, // GATE, not merely weighted
    completeness: 1,
    maintainability: 1,
    security: 1,
    simplicity: 1,
    effort_cost: 1,
    honesty: 1,
  },

  claudeBin: "claude",
};
