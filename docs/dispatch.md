# Dispatch / Judge harness

Give one task to three competing Claude Code agents, each pursuing a different **strategy**, in isolated git worktrees — then have a judge independently verify and score them.

```
           /dispatch <task>
                  │  same task, byte-identical, three strategy frames
      ┌───────────┼───────────┐
      ▼           ▼           ▼
  Hustler     Engineer     Native        (each: claude -p, opus, own git worktree)
 (laziest)  (by the book) (baseline)     (each MAY spawn persona-inherited subagents)
      └───────────┼───────────┘
                  ▼
              Judge (opus): re-runs each solution's tests in its worktree,
              scores the 7-criteria rubric, recommends a winner (or "all failed").
```

## How it runs (and why it costs no API credits)

- The orchestration lives in a **Pi extension** (`config/extensions/dispatch/`). Pi itself makes **no LLM calls** for this — `/dispatch` is a command handler that only does process management + git.
- Every agent (the 3 implementers **and** the judge) is a headless **Claude Code** process: `claude -p … --output-format stream-json --model opus`. They authenticate with your **Claude Code subscription** (OAuth), so they do **not** bill metered Anthropic API credits.
  - Requirement: `claude` on `PATH` and logged in (`claude auth status` → `authMethod: claude.ai`). Make sure `ANTHROPIC_API_KEY` is **unset**, or the CLI will switch to metered API billing.

## Invoke

**Dispatch is the default.** Launch `pi` from the repo you want to work on and just type your task as a normal prompt — it fans out to the three agents automatically (no `/dispatch` prefix needed):

```
cd ~/sites/my-site && pi
> redesign the homepage hero — bigger headline, new CTA, keep it responsive
```

The same thing explicitly: `/dispatch <task>`.

- The repo must be **clean** (`git status` empty) — worktrees are cut from `HEAD`, so whatever the agents need must be committed.
- Watch progress in the status notifications. On completion you get a per-agent summary (✓/✗, files, cost, turns), the judge's verdict (comparison table + recommendation), and the run directory.

### Normal Pi (single agent) when you want it

- `/chat <prompt>` — run one normal single-agent Pi turn (the model-router applies; uses your API key). Use this for quick questions you don't want to fan out.
- `/dispatch-mode off` — make freeform prompts behave like normal Pi again; `/dispatch-mode on` restores dispatch-by-default. (`/dispatch <task>` still works either way.)
- Slash commands (anything starting with `/`) are never intercepted, so all your routing commands (`/opus`, `/router-status`, …) keep working.

Standalone (no Pi):

```bash
node config/extensions/dispatch/cli.ts "<task>"
```

### After a run

- `/dispatch-promote <id>` — merge a winner's branch (`agent/hustler|engineer|native`) into `main` (`--no-ff`).
- `/dispatch-synthesize` — spawn an opus agent that reads all three worktrees + the verdict and builds a hybrid on `agent/synthesis`.

## Artifacts (audit everything)

Each run writes **artifacts** inside the repo at `.pi-dispatch/<runId>/` (gitignored):

```
.pi-dispatch/<runId>/
  <agent>/transcript.jsonl  every stream-json event the agent emitted
  <agent>/meta.json         exit code, timeout, duration, usage/cost
  judge/verdict.json        machine-readable scores + recommendation
  run.json                  the whole run record (incl. each agent's worktree path + diff)
```

The agents' actual **checkouts** are git worktrees placed in a **sibling** directory (never nested inside the repo, per git best practice):

```
../.<repo>-worktrees/<runId>/<agent>/    full isolated checkout (+ its RESULT.json), on branch agent/<id>
```

The judge's verification commands are reproducible — re-run any `how_to_run` inside the relevant worktree yourself. Clean up old worktrees with `git worktree remove <path>` (not `rm -rf`).

## Tuning

| Want to change… | Edit |
|---|---|
| A strategy's persona | `config/extensions/dispatch/personas/{hustler,engineer,native}.md` (body = system prompt; frontmatter `model:` per persona) |
| The shared output contract every agent must satisfy | `config/extensions/dispatch/output-contract.md` |
| The rubric criteria / judging protocol | `config/extensions/dispatch/judge-rubric.md` |
| Rubric **weights** | `rubricWeights` in `config/extensions/dispatch/config.ts` |
| Model (implementers / judge) | `model` / `judgeModel` in `config.ts` (`opus`/`sonnet`/`haiku`/`fable`) |
| Budgets (turns, wall-clock) | `maxTurns` / `wallClockMs` in `config.ts` |
| Recursion caps | `maxDepth` / `maxFanout` / `maxDescendants` in `config.ts` |

After editing files under `config/extensions/dispatch/`, re-run `./install.sh` (or copy to `~/.pi/agent/extensions/dispatch/`) and restart `pi`.

## Caps: what's hard vs soft (honest)

- **Depth (default 2): HARD.** Enforced in the harness — a subagent at max depth has the `Agent` tool withheld, so it physically cannot spawn further.
- **Fan-out (3), descendants (8), shared budget: SOFT.** Stated in the agent prompt only. The `claude` CLI exposes no hook to intercept each native subagent spawn, so these are on the agent's honour. (A custom MCP spawn tool could make them hard; that was deliberately not built for v1.)
- **Persona inheritance: real.** Claude Code subagents start fresh, so the parent's full persona text is embedded verbatim into each child's definition — the Hustler's children are lazy, the Engineer's rigorous.

## Notes / limitations

- `/dispatch-promote` targets `main` (see `promoteBranch` in `worktree.ts`); parameterize if your default branch differs.
- Effort/cost numbers come from each run's `total_cost_usd`/`num_turns` — useful as a relative effort signal even though your subscription isn't billed per token.
