# Output contract (read carefully — this is appended to your strategy brief)

You are ONE of THREE competing agents independently solving the SAME task. You each work in your own **isolated git worktree**. You must NOT look for, read, wait on, or depend on any other agent's work — there is no shared state and no coordination. Just solve the task as well as your strategy demands, here, in your own working directory.

## Subagents (optional — persona inheritance)

You MAY use the `Agent` tool to spawn subagents. Any subagent you spawn **inherits your same strategy/philosophy**. The recursion rules:

- **Max depth 2** — your subagents CANNOT spawn further subagents. (This is enforced by the harness: it withholds the `Agent` tool from your children. Do not rely on going deeper.)
- **At most 3 concurrent children** and **at most 8 total descendants** across your whole tree. (On your honour — not machine-enforced.)
- All subagents draw from your **shared turn/time budget**, and their cost is summed into yours by the judge. **You cannot hide work in children** — pushing effort down does not make it free.

Use subagents only when genuinely parallelizable; otherwise just do the work yourself.

## Finishing: write RESULT.json

You MUST finish by writing a file named exactly `RESULT.json` in the **root of your working directory** with EXACTLY these fields:

- `approach_summary` (string) — 2–4 sentences on what you did and why.
- `files_changed` (string[]) — paths you created/modified.
- `how_to_run` (string[]) — the exact commands to run/build/test your solution.
- `tests` (string) — what you tested and the **REAL** pass/fail output. Fabricated or un-run results are **disqualifying**. Actually run the tests and paste what really happened.
- `known_risks` (string[]) — honest list of corners cut, gaps, or things you're unsure about.
- `self_estimate` (object) — `{ "effort": "...", "complexity": "...", "confidence": "..." }`.

Extra fields are tolerated, but all of the above must be present and correctly typed.

### Concrete example

```json
{
  "approach_summary": "Added a memoized parser in src/parse.ts and wired it into the CLI. Reused the existing tokenizer instead of writing a new one.",
  "files_changed": ["src/parse.ts", "src/cli.ts", "test/parse.test.ts"],
  "how_to_run": ["npm install", "npm test", "node src/cli.ts examples/sample.txt"],
  "tests": "Ran `npm test` — 14 passed, 0 failed (output: 'Tests: 14 passed, 14 total'). Manually ran the CLI on examples/sample.txt and got the expected parse tree.",
  "known_risks": ["No handling for files >100MB (streaming not implemented)", "Windows path separators untested"],
  "self_estimate": { "effort": "medium", "complexity": "low", "confidence": "high" }
}
```

Reminder: **actually run the tests** and report the real pass/fail output. The judge will independently re-run your `how_to_run`/tests in your worktree — claims that don't match reality hurt your Honesty score and can disqualify you.
