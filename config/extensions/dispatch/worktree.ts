// worktree.ts — git isolation via plain git (no Pi dependency).
//
// Each competing agent runs in its own `git worktree` on its own branch, all
// forked from the same base SHA, so their edits never collide. The harness reads
// git output directly (utf8) and computes diffs authoritatively rather than
// trusting any agent's self-reported file list.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexecFile = promisify(execFile);

// Generous buffer; git diff of a sizeable change can be large.
const MAX_BUFFER = 64 * 1024 * 1024;
const DIFF_CAP = 200 * 1024; // 200 KB cap on returned patch text

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexecFile("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

export async function getBaseSha(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
}

export async function assertCleanRepo(repoRoot: string): Promise<void> {
  const status = (await git(repoRoot, ["status", "--porcelain"])).trim();
  if (status)
    throw new Error(
      "Working tree is not clean. Commit or stash changes before /dispatch.\n" + status,
    );
}

// `git worktree add -b <branch> <path> <baseSha>`. If the branch already exists,
// fall back to a unique suffixed branch so the run can proceed without clobbering.
export async function createWorktree(
  repoRoot: string,
  branch: string,
  baseSha: string,
  path: string,
): Promise<void> {
  try {
    await git(repoRoot, ["worktree", "add", "-b", branch, path, baseSha]);
  } catch (e) {
    const msg = (e as Error).message || "";
    if (/already exists/i.test(msg)) {
      const unique = `${branch}-${Date.now().toString(36)}`;
      await git(repoRoot, ["worktree", "add", "-b", unique, path, baseSha]);
    } else {
      throw new Error(`createWorktree(${branch}) failed: ${msg}`);
    }
  }
}

// Commit ALL of an agent's changes — INCLUDING newly-created (untracked) files —
// onto its branch. This matters twice over:
//   1. Honest accounting: plain `git diff <base>` ignores untracked files, so a
//      new package.json would be invisible. `git add -A` makes it tracked, so the
//      diff/filesChanged below capture the agent's FULL footprint.
//   2. Promotable branch: agents edit the working tree but never commit, so without
//      this the branch stays at base and `/dispatch-promote` would merge nothing.
// Returns true if a commit was made (false if the agent changed nothing).
export async function commitWorktree(worktreePath: string, message: string): Promise<boolean> {
  const status = (await git(worktreePath, ["status", "--porcelain"])).trim();
  if (!status) return false;
  await git(worktreePath, ["add", "-A"]);
  await git(worktreePath, ["commit", "-q", "-m", message]);
  return true;
}

// Run `git diff <baseSha> -- .` INSIDE the worktree; cap the patch text. Never throws on size.
export async function diffWorktree(
  _repoRoot: string,
  worktreePath: string,
  baseSha: string,
): Promise<string> {
  let out = "";
  try {
    out = await git(worktreePath, ["diff", baseSha, "--", "."]);
  } catch (e) {
    return `[diff failed: ${(e as Error).message}]`;
  }
  if (out.length > DIFF_CAP) {
    return (
      out.slice(0, DIFF_CAP) +
      `\n…[diff truncated — full patch was ${out.length} bytes, capped at ${DIFF_CAP}]`
    );
  }
  return out;
}

export async function filesChanged(
  worktreePath: string,
  baseSha: string,
): Promise<string[]> {
  let out: string;
  try {
    out = await git(worktreePath, ["diff", "--name-only", baseSha]);
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Best-effort teardown; swallow errors (worktree may already be gone).
export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  try {
    await git(repoRoot, ["worktree", "remove", "--force", path]);
  } catch {
    /* best-effort */
  }
}

// Used by /dispatch-promote: checkout main, then merge the winning branch with a merge commit.
export async function promoteBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ["checkout", "main"]);
  await git(repoRoot, ["merge", "--no-ff", branch]);
}
