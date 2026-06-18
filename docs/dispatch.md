# Dispatch / Judge harness

Give one task to three competing Claude Code agents that each pursue a different **strategy**. The default flow is **plan-first**: the agents *propose* plans (read-only), a judge recommends one, and you pick one to implement on `main`. An optional **build mode** instead has all three actually implement competing solutions in isolated worktrees.

```
           <type your task>   (or /dispatch <task>)
                  │  same task, three strategy frames, READ-ONLY
      ┌───────────┼───────────┐
      ▼           ▼           ▼
  Hustler     Engineer     Native        (each: claude -p, opus, propose a PLAN — no code changes)
 (leanest)  (by the book) (baseline)
      └───────────┼───────────┘
                  ▼
              Judge (opus): reads the repo to verify each plan's claims/paths,
              scores the 6-criteria rubric, recommends ONE plan.
                  │
                  ▼
       /dispatch-pick <id>  →  ONE agent implements that plan on main (reviewable via git diff)
```

## How it runs (and why it costs no API credits)

- The orchestration lives in a **Pi extension** (`config/extensions/dispatch/`). Pi itself makes **no LLM calls** — `/dispatch` is a command handler doing process management.
- Every agent (the 3 planners **and** the judge) is a headless **Claude Code** process: `claude -p … --output-format stream-json --model opus`. They authenticate with your **Claude Code subscription** (OAuth), so they do **not** bill metered Anthropic API credits.
  - Requirement: `claude` on `PATH` and logged in (`claude auth status` → `authMethod: claude.ai`). Keep `ANTHROPIC_API_KEY` **unset**, or the CLI switches to metered API billing.

## Invoke (plan-first — the default)

Launch `pi` from the repo you want to work on and just type your task as a normal prompt — it fans out to the three **planners** automatically:

```
cd ~/sites/my-site && pi
> redesign the homepage hero — bigger headline, new CTA, keep it responsive
```

- Planners are **read-only** (`Read/Grep/Glob/WebSearch/WebFetch` — no Edit/Write/Bash), so they **cannot modify your repo**. No worktrees, no branches, and **no clean-repo requirement** — you can plan against an in-progress tree.
- You get each agent's full plan, then the judge's comparison table + recommendation.
- Then **`/dispatch-pick <id>`** (e.g. `/dispatch-pick engineer`) spawns **one** agent that implements that plan **directly on your working tree**. Review with `git diff`; keep it, commit it, or `git checkout .` to discard. (Picking on a dirty tree mixes the new changes with your existing ones — start clean if you want a clean diff.)
- Or don't pick — refine your prompt and re-run, or do something else entirely.

The same plan flow explicitly: `/dispatch <task>`.

Standalone (no Pi):

```bash
node config/extensions/dispatch/cli.ts "<task>"                 # plan only
node config/extensions/dispatch/cli.ts --pick engineer "<task>" # plan, then implement engineer's plan on main
node config/extensions/dispatch/cli.ts --build "<task>"         # build mode (below)
```

## Build mode (optional): implement all three and compare

When you actually want a competitive bake-off rather than a plan, use **build mode**: all three agents *implement* the task in isolated git worktrees off a pinned base, the judge re-runs their tests, and you promote a winner.

```
/dispatch-build <task>      3 agents implement competing solutions (worktrees) + judge
/dispatch-promote <id>      merge a winner's branch (agent/hustler|engineer|native) into main
/dispatch-synthesize        spawn an agent to build a hybrid on agent/synthesis
```

Build mode **requires a clean repo** (worktrees are cut from `HEAD`, so whatever the agents need must be committed) and leaves worktrees in a sibling dir + `agent/*` branches behind (no auto-cleanup yet).

## Normal Pi (single agent) when you want it

- `/chat <prompt>` — run one normal single-agent Pi turn (the model-router applies; uses your API key). For quick questions you don't want to fan out.
- `/dispatch-mode off` — freeform prompts behave like normal Pi again; `/dispatch-mode on` restores dispatch-by-default. (`/dispatch <task>` and `/dispatch-build <task>` still work either way.)
- Slash commands (anything starting with `/`) are never intercepted, so `/opus`, `/router-status`, etc. keep working.

## Artifacts (audit everything)

Each run writes to `.pi-dispatch/<runId>/` (gitignored):

```
.pi-dispatch/<runId>/
  <agent>/plan.md           the agent's proposed plan (plan mode)
  <agent>/transcript.jsonl  every stream-json event the agent emitted
  <agent>/meta.json         exit code, timeout, duration, usage/cost
  judge/verdict.json        machine-readable scores + recommendation
  run.json                  the whole run record
```

Implement runs (from `/dispatch-pick`) write to `.pi-dispatch/impl-<runId>/`. Build mode additionally creates git worktrees in a **sibling** dir `../.<repo>-worktrees/<runId>/<agent>/` (never nested in the repo, per git best practice; clean up with `git worktree remove <path>`).

## Tuning

| Want to change… | Edit |
|---|---|
| A strategy's persona | `config/extensions/dispatch/personas/{hustler,engineer,native}.md` (body = system prompt; frontmatter `model:` per persona) |
| The planning contract (what planners must output) | `config/extensions/dispatch/plan-contract.md` |
| The plan judging rubric | `config/extensions/dispatch/plan-rubric.md` |
| The build-mode contract / rubric | `config/extensions/dispatch/output-contract.md` / `judge-rubric.md` |
| Rubric **weights** | `rubricWeights` in `config/extensions/dispatch/config.ts` |
| Models (agents / judge) | `model` / `judgeModel` in `config.ts` (`opus`/`sonnet`/`haiku`/`fable`) |
| Budgets (planner turns, implementer turns, wall-clock) | `plannerMaxTurns` / `maxTurns` / `wallClockMs` in `config.ts` |
| Tool sets (planner read-only / implementer / judge) | `plannerTools` / `implementerTools` / `judgeAllowedTools` in `config.ts` |

After editing files under `config/extensions/dispatch/`, re-run `./install.sh` (or copy to `~/.pi/agent/extensions/dispatch/`) and restart `pi`.

## Caps (build mode subagents): what's hard vs soft (honest)

- **Depth (default 2): HARD** — a subagent at max depth has the `Agent` tool withheld, so it physically cannot spawn further.
- **Fan-out (3), descendants (8), shared budget: SOFT** — prompt-stated only; the `claude` CLI exposes no hook to enforce them per spawn.
- **Persona inheritance: real** — a parent's full persona text is embedded verbatim into each child's definition.

(Plan mode planners are read-only and single-process, so caps don't apply there.)

## Notes / limitations

- `/dispatch-promote` (build mode) targets `main`; parameterize `promoteBranch` in `worktree.ts` if your default branch differs.
- Effort/cost numbers come from each run's `total_cost_usd`/`num_turns` — a relative effort signal even though your subscription isn't billed per token.
- Build-mode worktrees/branches are not auto-removed (`/dispatch-clean` is not yet implemented).
