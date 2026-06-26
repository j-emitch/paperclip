/**
 * `buildCheckoutKeyMap` — the SHARED worktree-aware key map used by BOTH
 * `makeCollectionContext` (collection time) and the `doc-content` handler
 * (render time), so the two derive the IDENTICAL `absByKey` (PF-7/PF-8/PF-9).
 *
 * It registers, per configured repo root: the main `repoKey → absPath`, plus —
 * via `git worktree list --porcelain` — a PSEUDO-KEY `${repoKey}::wt::${hash}`
 * for every NON-primary worktree (skipping the primary-checkout entry git lists
 * first). Worktrees that live OUTSIDE the repo root (codex-cli worktrees) are
 * covered because the key resolves to the worktree's own abs root — the abs path
 * stays inside this map and never leaks to a source (key-only invariant).
 *
 * It `sanitizeRepoRoots`-es internally (the SAME dup-basename dedup the taxonomy
 * + collection use) so a dropped duplicate-basename root is unreadable at render
 * → a clean `not_found` (no index/root mismatch, v7).
 *
 * This module lives in `src/runtime/` (the only layer allowed to touch
 * `node:child_process`) and builds its OWN default git runner, so the worker
 * data-handler — which has no `GitRunner` — can call it with no dependency to
 * thread. Tests inject `opts.gitRun`.
 */

import { execFile, type ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { WorktreeCheckout } from "../contracts/collection-context.js";
import { sanitizeRepoRoots } from "../contracts/projects.js";
import { parseWorktreeList } from "../sources/git-helpers.js";
import { repoKey } from "./workspace-fs.js";

/** Minimal git runner shape (cwd + argv → stdout + exit code). */
export type CheckoutGitRun = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; code: number | null }>;

export interface CheckoutKeyMap {
  /** Main repoKeys + worktree pseudo-keys → absolute path. */
  readonly absByKey: Map<string, string>;
  readonly worktrees: WorktreeCheckout[];
  /** The sanitized (deduped) main roots, for building `RepoRoot[]`. */
  readonly mainRoots: { repoKey: string; absPath: string }[];
  /** Sanitizer diagnostics (dup-basename drops). */
  readonly diagnostics: Diagnostic[];
}

const WT_HASH_LEN = 12;
const GIT_TIMEOUT_MS = 15_000;

/** The default execFile-based git runner (no shell, fixed argv, hard timeout). */
const defaultGitRun: CheckoutGitRun = (cwd, args) =>
  new Promise((resolve) => {
    execFile(
      "git",
      [...args],
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error: ExecFileException | null, stdout: string) => {
        if (error) {
          resolve({ stdout: stdout ?? "", code: typeof error.code === "number" ? error.code : null });
          return;
        }
        resolve({ stdout: stdout ?? "", code: 0 });
      },
    );
  });

function hashPath(absPath: string): string {
  return createHash("sha256").update(absPath).digest("hex").slice(0, WT_HASH_LEN);
}

/** True when two paths resolve to the same real location (the primary-checkout skip). */
async function isSameLocation(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export async function buildCheckoutKeyMap(
  repoRoots: readonly string[],
  opts?: { gitRun?: CheckoutGitRun },
): Promise<CheckoutKeyMap> {
  const gitRun = opts?.gitRun ?? defaultGitRun;
  const { roots, diagnostics } = sanitizeRepoRoots(repoRoots);
  const absByKey = new Map<string, string>();
  const worktrees: WorktreeCheckout[] = [];
  const mainRoots: { repoKey: string; absPath: string }[] = [];

  for (const root of roots) {
    const key = repoKey(root);
    absByKey.set(key, root);
    mainRoots.push({ repoKey: key, absPath: root });

    const res = await gitRun(root, ["worktree", "list", "--porcelain"]);
    if (res.code !== 0) continue; // missing / non-git root → no worktrees to register

    for (const wt of parseWorktreeList(res.stdout)) {
      if (await isSameLocation(wt.path, root)) continue; // skip the primary checkout (git lists it first)
      const pseudoKey = `${key}::wt::${hashPath(wt.path)}`;
      absByKey.set(pseudoKey, wt.path);
      worktrees.push({
        key: pseudoKey,
        checkoutId: checkoutIdFromKey(pseudoKey),
        parentRepoKey: key,
        branch: wt.branch,
        name: path.basename(wt.path.replace(/\/+$/, "")),
      });
    }
  }

  return { absByKey, worktrees, mainRoots, diagnostics };
}

/** Derive the stable `checkoutId` from a checkout key: "main" or "worktree:${hash}". */
export function checkoutIdFromKey(checkoutKey: string): string {
  const idx = checkoutKey.indexOf("::wt::");
  return idx === -1 ? "main" : `worktree:${checkoutKey.slice(idx + "::wt::".length)}`;
}
