// caps.ts — recursion cap enforcement.
//
// HONESTY: only DEPTH is hard. We enforce it by REMOVING the "Agent" tool from a
// subagent's tool list once it would sit at the configured maxDepth — a subagent
// with no "Agent" tool literally cannot spawn further children.
//
// FAN-OUT (maxFanout concurrent) and DESCENDANTS (maxDescendants total) and the
// shared BUDGET are SOFT: they are stated in the subagent's prompt only. The
// claude CLI gives us no mechanism to truly enforce them, so they are on the
// agent's honour. This is an accepted, documented limitation.

import type { DispatchConfig, Persona } from "./config.ts";

// Env additions that record the current recursion depth. Passed through spawn env
// so a future depth-aware layer could read it; the hard cap itself is tool-based.
export function depthEnv(depth: number): Record<string, string> {
  return { PI_DISPATCH_DEPTH: String(depth) };
}

// Build the `--agents` JSON defining ONE inheritable child agent that carries the
// SAME persona philosophy plus the soft-cap notice.
//
// Depth arithmetic (with maxDepth=2):
//   - top-level implementer runs at depth 1.
//   - its children run at depth 2.
//   - depth+1 (2) >= maxDepth (2)  → children get tools MINUS "Agent" → they cannot
//     spawn further. So with the default config, descendants are capped at depth 2
//     and the tree is at most 2 levels deep. (Verified.)
export function buildSubagentDefs(
  persona: Persona,
  personaBody: string,
  depth: number,
  config: DispatchConfig,
): Record<string, unknown> {
  const childDepth = depth + 1;
  const childAtCap = childDepth >= config.maxDepth;

  // Hard depth cap: strip "Agent" from the child's tools when it would be at maxDepth.
  const childTools = childAtCap
    ? config.allowedTools.filter((t) => t !== "Agent")
    : config.allowedTools.slice();

  // Persona inheritance is REAL: Claude Code subagents start fresh (they do NOT see
  // the parent's appended system prompt), so we embed the parent's full persona body
  // verbatim. The Hustler's children are lazy; the Engineer's children are rigorous.
  const personaPhilosophy =
    `You are a "${persona.id}"-strategy subagent. You INHERIT — verbatim — the exact same strategy and philosophy as the agent that spawned you (reproduced below). Apply it faithfully to whatever slice of the work you are handed.\n\n` +
    `--- INHERITED STRATEGY (${persona.id}) ---\n${personaBody.trim()}\n--- END INHERITED STRATEGY ---`;

  const softCaps =
    `\n\nSHARED-BUDGET & FAN-OUT RULES (on your honour — not machine-enforced):\n` +
    `- You may spawn at most ${config.maxFanout} concurrent children.\n` +
    `- The whole tree under the top-level agent may have at most ${config.maxDescendants} total descendants.\n` +
    `- All of you draw from the SAME shared turn/time budget as the parent — work you push into children is NOT free and is counted against the parent in judging.\n` +
    (childAtCap
      ? `- You are at the maximum depth: you CANNOT spawn further subagents (the Agent tool has been withheld from you). Do the work yourself.`
      : `- You may spawn one more level of these same-strategy subagents if it genuinely helps.`);

  return {
    [`${persona.id}-sub`]: {
      description: `Inherited ${persona.id}-strategy subagent (depth ${childDepth}).`,
      prompt: personaPhilosophy + softCaps,
      tools: childTools,
    },
  };
}
