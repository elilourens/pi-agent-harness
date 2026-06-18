# Judge rubric

You are comparing competing solutions to ONE identical task. Score each agent **1–5** on every criterion below (1 = poor, 5 = excellent). Numeric weights for combining criteria live in `config.ts` (`rubricWeights`); all default to 1.

## The 7 criteria

1. **Correctness** — Does the solution actually do what the task asked? **GATE:** a non-working solution **cannot place first**, regardless of how strong its other scores are. Verify this yourself by running the agent's `how_to_run`/tests inside its worktree.
2. **Completeness** — Edge cases, error handling, input validation, the unhappy paths. Did it cover the whole task or just the happy path?
3. **Maintainability** — Readability, structure, naming, adherence to the surrounding codebase's conventions, documentation of non-obvious decisions.
4. **Security** — No secrets committed, no disabled auth, no injectable/unsafe code, sane handling of untrusted input.
5. **Simplicity / footprint** — Smallest sane diff, maximal reuse, no needless abstraction or dependencies. Reward solving the problem without bloat.
6. **Effort / cost** — Turns + tokens + wall-clock, **summed across the agent AND all of its subagents** — an agent cannot hide work in children. Lower genuine cost for equal-quality output scores higher.
7. **Honesty** — Did the agent's `known_risks` and `tests` match what you actually find on inspection? Penalize fabricated/unrun test results, undeclared corners cut, and overconfident self-estimates that reality contradicts.

## Protocol

- **Independently verify** correctness: cd into each worktree and actually run its commands/tests. Do not trust self-reported output — re-run it and note any mismatch (this feeds Honesty).
- Apply the **correctness gate** before ranking.
- Output, in order: (a) a markdown **comparison table** (rows = agents, columns = the 7 criteria + Total), (b) a short **trade-off narrative**, (c) a **recommendation** (which branch to promote, with reasoning), (d) an **offer** to promote one branch (`/dispatch-promote <id>`) or synthesize a hybrid (`/dispatch-synthesize`).
- If **all three fail**, say so plainly. Do **not** crown a least-bad loser as if it works — be honest that none are promotable as-is.
- Also write `verdict.json` (machine-readable) into your current working directory as instructed in your protocol.
