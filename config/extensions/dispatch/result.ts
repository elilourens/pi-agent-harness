// result.ts — the output contract every implementer must satisfy.
//
// Each implementer finishes by writing RESULT.json into the root of its working
// directory (its worktree). The harness reads + validates it here. The git diff
// is NOT trusted from the agent — the harness computes it authoritatively (worktree.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AgentResult {
  approach_summary: string; // 2–4 sentences
  files_changed: string[];
  how_to_run: string[]; // exact commands
  tests: string; // what was tested + REAL pass/fail output (fabrication is disqualifying)
  known_risks: string[];
  self_estimate: {
    effort: string;
    complexity: string;
    confidence: string;
  };
}

export type ReadResult =
  | { ok: true; value: AgentResult }
  | { ok: false; error: string };

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// Validate required fields; tolerate (and preserve) any extra fields.
export function readResult(worktreePath: string): ReadResult {
  const path = join(worktreePath, "RESULT.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, error: `RESULT.json not found at ${path}` };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `RESULT.json is not valid JSON: ${(e as Error).message}` };
  }

  if (typeof parsed !== "object" || parsed === null)
    return { ok: false, error: "RESULT.json must be a JSON object" };

  if (typeof parsed.approach_summary !== "string")
    return { ok: false, error: "approach_summary must be a string" };
  if (!isStringArray(parsed.files_changed))
    return { ok: false, error: "files_changed must be a string[]" };
  if (!isStringArray(parsed.how_to_run))
    return { ok: false, error: "how_to_run must be a string[]" };
  if (typeof parsed.tests !== "string")
    return { ok: false, error: "tests must be a string" };
  if (!isStringArray(parsed.known_risks))
    return { ok: false, error: "known_risks must be a string[]" };

  const se = parsed.self_estimate;
  if (
    typeof se !== "object" ||
    se === null ||
    typeof se.effort !== "string" ||
    typeof se.complexity !== "string" ||
    typeof se.confidence !== "string"
  )
    return {
      ok: false,
      error: "self_estimate must be { effort:string, complexity:string, confidence:string }",
    };

  return { ok: true, value: parsed as AgentResult };
}
