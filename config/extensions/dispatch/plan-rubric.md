# Plan judging rubric

You are comparing competing **plans** (not implementations) for ONE identical task. Nothing has been built yet — judge the proposals on their merits as plans. Score each plan **1–5** on every criterion below (1 = poor, 5 = excellent). Numeric weights for combining criteria live in `config.ts` (`rubricWeights`); all default to 1.

You can read the actual repository (it is provided via `--add-dir`). **Verify the plans' claims** — check that the file paths they cite exist and that the proposed approach is actually compatible with how this codebase works. Note where a plan misreads the code or invents paths/APIs.

## The 6 criteria

1. **Feasibility / correctness** — Would this plan, executed as written, actually work on THIS codebase and satisfy the task? **GATE:** a plan that would not work (wrong APIs, non-existent files, a fundamentally broken approach) **cannot be recommended**, regardless of how strong its other scores are.
2. **Completeness** — Does it cover edge cases, error handling, input validation, and tests — not just the happy path? Are the steps sufficient to actually finish the task?
3. **Maintainability of the proposed design** — Would the result be readable, well-structured, and consistent with the surrounding codebase's conventions? Does it avoid needless complexity?
4. **Risk** — How likely is execution to go wrong, and how large is the blast radius if it does? Reward plans that contain risk and call it out honestly.
5. **Simplicity / footprint** — Smallest sane change, maximal reuse, no gratuitous new dependencies or abstractions for the proposed approach.
6. **Effort / cost** — Rough size of the work the plan implies. Lower genuine effort for equal-quality outcome scores higher.

## Protocol

- **Read the repo** to verify each plan's file paths and claims before scoring. Treat a plan that cites paths/APIs that do not exist as a feasibility failure.
- Apply the **feasibility gate** before recommending: only a workable plan can be recommended.
- Recommend **exactly one** plan to implement — or **none** if all are unviable. Be honest: if no plan is sound, say so plainly rather than crowning a least-bad one.
- Output, in order: (a) a markdown **comparison table** (rows = plans by agent id, columns = the 6 criteria + Total), (b) a short **narrative** (2–5 sentences) on the trade-offs, (c) a **recommendation** (which plan to implement, with reasoning — or that none are viable), and (d) the literal line:
  `Pick one to implement on main: /dispatch-pick <id>  (or refine and re-run)`
- Note in your narrative that you verified file paths/claims by reading the repo.
- Also write `verdict.json` (machine-readable) into your current working directory as instructed in your protocol.
