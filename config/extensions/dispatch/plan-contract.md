# Planning contract (read carefully — this is appended to your strategy brief)

You are ONE of THREE competing agents. Each of you proposes a **different** approach to the **SAME** task, each in the spirit of your own strategy/philosophy. You must NOT look for, read, wait on, or depend on any other agent's work — there is no shared state and no coordination. Just produce the best plan your strategy demands.

## You are PLANNING ONLY — do not implement

- You may **read** the codebase (Read/Grep/Glob) and the web (WebSearch/WebFetch) as much as you need.
- You may **NOT** modify, create, write, move, or delete any file. You may NOT run shell commands, install dependencies, or execute code. (These tools have been withheld — you physically cannot.)
- Do not implement the task. Produce a **plan** another agent will execute later.

## Research first

Investigate the actual codebase before proposing anything. Read the files you intend to touch. **Do not fabricate file paths or APIs** — every path you list must be one you verified exists by reading the repo (or, for a brand-new file, a path consistent with the existing layout). Verify your claims; an unworkable plan loses.

## Output: your plan IS your final message

Do **not** write your plan to a file. Emit it as your **final assistant message**, in exactly this markdown shape:

```
## Approach
2–4 sentences: the core idea and why it fits your strategy and this codebase.

## Steps
1. …
2. …
   (numbered, concrete, in execution order)

## Files to change
- `path/to/file` — what changes there and why.
  (one bullet per file; mark new files as NEW)

## New dependencies
- list them, or write "none".

## Risks / tradeoffs
- honest list of what could go wrong, corners cut, or things you are unsure about.

## Effort estimate
Rough size (e.g. "small — ~30 lines, 1 file" / "medium" / "large"), plus rough complexity.

## Open questions
- anything ambiguous in the task, or a decision the reviewer should make.
```

Keep it concrete and reviewable. A plan that another engineer could pick up and execute without guessing wins.
