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
  wallClockMs: number;
  allowedTools: string[];
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
  wallClockMs: 1_200_000, // 20 min

  // Tools granted to implementers ("Agent" enables native subagents / persona inheritance).
  allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "Agent"],

  // Judge gets read + verify ability (Bash to run tests) + Write (to emit verdict.json).
  judgeAllowedTools: ["Read", "Bash", "Grep", "Glob", "Write"],

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
