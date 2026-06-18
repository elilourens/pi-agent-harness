# Sample task: `parseDuration`

A small, self-contained, dependency-free task used to demo the dispatch/judge harness.

## Goal

Implement `parseDuration(input)` in `duration.mjs` so the committed test suite passes:

```bash
node --test examples/sample-task/
```

## Spec

`parseDuration(input: string): number` converts a human duration string into **milliseconds**.

- Supports unit tokens `d` (days), `h` (hours), `m` (minutes), `s` (seconds), `ms` (milliseconds).
- A string may combine tokens, e.g. `"1h30m"`, `"2d4h"`, `"500ms"`, `"45s"`.
- Whitespace between tokens is allowed and ignored: `"1h 30m"`.
- Numbers are non-negative integers. The result is the sum of all tokens in ms.
- Invalid input (empty string, unknown unit, non-numeric, negative, malformed) must `throw` a `TypeError`.

### Examples

| input        | output (ms)   |
|--------------|---------------|
| `"45s"`      | `45000`       |
| `"1h30m"`    | `5400000`     |
| `"2d"`       | `172800000`   |
| `"500ms"`    | `500`         |
| `"1h 30m"`   | `5400000`     |
| `""`         | throws        |
| `"10x"`      | throws        |
| `"-5s"`      | throws        |

The acceptance check is `node --test examples/sample-task/` exiting 0.
