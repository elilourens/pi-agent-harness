// spawn.ts — spawn ONE Claude Code headless agent. The recursive primitive.
//
// Pure Node, no Pi. Used for both top-level implementers and the judge.
//
// SUBSCRIPTION AUTH: we pass process.env through UNCHANGED and never set
// ANTHROPIC_API_KEY, so the claude CLI uses the user's subscription OAuth (not
// API credits). Do not "helpfully" inject any Anthropic key here.

import { spawn } from "node:child_process";
import { CONFIG } from "./config.ts";

export interface SpawnOpts {
  task: string;
  appendSystemPrompt: string;
  model: string;
  cwd: string;
  allowedTools: string[];
  agentsJson?: Record<string, unknown>;
  maxTurns: number;
  wallClockMs: number;
  addDirs?: string[];
  env?: NodeJS.ProcessEnv; // defaults to process.env (subscription auth)
  onEvent?: (evt: any) => void;
  signal?: AbortSignal;
}

export interface SpawnUsage {
  cost: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SpawnResult {
  exitCode: number | null;
  finalResult: any | null; // the {type:"result"} object, if seen
  resultText: string;
  usage: SpawnUsage;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

const ZERO_USAGE = (): SpawnUsage => ({
  cost: 0,
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

function usageFromResult(r: any): SpawnUsage {
  const u = r?.usage ?? {};
  return {
    cost: typeof r?.total_cost_usd === "number" ? r.total_cost_usd : 0,
    turns: typeof r?.num_turns === "number" ? r.num_turns : 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

export function spawnClaudeAgent(opts: SpawnOpts): Promise<SpawnResult> {
  // Verified headless flags — keep EXACTLY these names.
  const argv: string[] = [
    "-p",
    opts.task,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    opts.model,
    "--permission-mode",
    "acceptEdits",
    "--max-turns",
    String(opts.maxTurns),
    "--allowedTools",
    opts.allowedTools.join(","),
    "--append-system-prompt",
    opts.appendSystemPrompt,
  ];
  if (opts.agentsJson) argv.push("--agents", JSON.stringify(opts.agentsJson));
  for (const d of opts.addDirs ?? []) argv.push("--add-dir", d);

  const start = Date.now();

  return new Promise<SpawnResult>((resolve) => {
    // detached:true → own process group, so we can kill the whole tree on timeout.
    const child = spawn(CONFIG.claudeBin, argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env, // subscription auth — env passed through unchanged
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let finalResult: any = null;
    let resultText = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuf = "";
    let settled = false;

    const killTree = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };

    const wallTimer = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5_000);
    }, opts.wallClockMs);

    const onAbort = () => {
      timedOut = true; // treat external abort like a timeout for accounting
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), 5_000);
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: any;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return; // non-JSON line — ignore defensively
      }
      try {
        opts.onEvent?.(evt);
      } catch {
        /* never let UI callback break the stream */
      }
      if (evt?.type === "result") {
        finalResult = evt;
        if (typeof evt.result === "string") resultText = evt.result;
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        handleLine(line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      opts.signal?.removeEventListener?.("abort", onAbort);
      if (stdoutBuf.trim()) handleLine(stdoutBuf); // flush any trailing partial line
      const usage = finalResult ? usageFromResult(finalResult) : ZERO_USAGE();
      resolve({
        exitCode,
        finalResult,
        resultText,
        usage,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    };

    // Never reject on nonzero exit — surface it via exitCode.
    child.on("error", (err) => {
      stderr += `\n[spawn error: ${(err as Error).message}]`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
