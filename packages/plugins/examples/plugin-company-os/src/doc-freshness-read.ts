/**
 * `readDocFreshness` — the worker side of the `doc-git-freshness` handler
 * (COS-8f T3). Places one indexed doc copy on the 5-state ladder:
 *
 *   main        — the main-checkout copy (trunk-side by definition).
 *   uncommitted — dirty, untracked, OR ignored in its worktree (the index walks
 *                 the filesystem, so an ignored doc is still an indexed copy).
 *   committed   — committed on the branch, not on its upstream.
 *   pushed      — on the upstream, still differs from trunk.
 *   merged      — content identical to the trunk TIP (catches squash-merges), or
 *                 no branch-side changes vs the merge-base. Checked BEFORE the
 *                 upstream rungs so a detached checkout at a merged commit lands
 *                 here instead of short-circuiting to `committed`.
 *
 * Defense ladder mirrors `readDocContent`: (1) INDEX GATE — only an indexed
 * `docId` is readable; (2) CHECKOUT RESOLVABLE — a pruned worktree is a typed
 * `checkout_gone` (§4.1 row 4); (3) BOUNDED GIT — fixed-argv calls against the
 * resolved root, failures → typed `git_error`, never a throw.
 */

import type { DocEntryV1, DocIndexV1 } from "./contracts/doc-index.js";
import { DOC_GIT_SCHEMA_VERSION, parseDocFreshnessV1, type DocFreshnessV1 } from "./contracts/doc-git.js";
import { TRUNK_CANDIDATES } from "./sources/git-helpers.js";

/** Git runner bound to a CHECKOUT KEY (the worker resolves the abs root). */
export type DocGitRun = (checkoutKey: string, args: readonly string[]) => Promise<{ stdout: string; code: number | null }>;

export interface DocGitDeps {
  /** Read the cached doc index (the worker wires `readDocIndex(db, …)`). */
  readIndex: (companyId: string) => Promise<DocIndexV1 | null>;
  /** Whether a `checkoutKey` resolves in the freshly rebuilt map. */
  checkoutResolvable: (checkoutKey: string) => boolean;
  /** Bounded git by checkoutKey — the abs root never leaves the worker. */
  gitRun: DocGitRun;
}

export function findDocEntry(index: DocIndexV1 | null, docId: string): DocEntryV1 | null {
  if (!index) return null;
  for (const group of index.groups) {
    for (const bucket of group.types) {
      for (const doc of bucket.docs) {
        if (doc.docId === docId) return doc;
      }
    }
  }
  return null;
}

/** First trunk ref that exists in this checkout (origin/main → main → …). */
export async function resolveTrunkRef(gitRun: DocGitRun, checkoutKey: string): Promise<string | null> {
  for (const candidate of TRUNK_CANDIDATES) {
    const r = await gitRun(checkoutKey, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (r.code === 0) return candidate;
  }
  return null;
}

function base(entry: DocEntryV1, docId: string): Omit<DocFreshnessV1, "status" | "state" | "message"> {
  return {
    schemaVersion: DOC_GIT_SCHEMA_VERSION,
    docId,
    repoKey: entry.repoKey,
    relPath: entry.relPath,
    checkout: entry.worktreeName ?? "main",
    branch: entry.branch,
  };
}

export async function readDocFreshness(deps: DocGitDeps, companyId: string, docId: string): Promise<DocFreshnessV1> {
  if (!docId) {
    return parseDocFreshnessV1({
      schemaVersion: DOC_GIT_SCHEMA_VERSION,
      status: "not_indexed",
      docId: "?",
      repoKey: "?",
      relPath: "?",
      checkout: "?",
      branch: null,
      state: null,
      message: "No document selected.",
    });
  }

  const index = await deps.readIndex(companyId);
  const entry = findDocEntry(index, docId);
  if (!entry) {
    return parseDocFreshnessV1({
      schemaVersion: DOC_GIT_SCHEMA_VERSION,
      status: "not_indexed",
      docId,
      repoKey: "?",
      relPath: "?",
      checkout: "?",
      branch: null,
      state: null,
      message: "This doc isn’t in the index — refresh the cockpit or pick a listed doc.",
    });
  }

  if (!deps.checkoutResolvable(entry.checkoutKey)) {
    return parseDocFreshnessV1({
      ...base(entry, docId),
      status: "checkout_gone",
      state: null,
      message: "This checkout no longer exists — the worktree was removed since the last index.",
    });
  }

  // The main-checkout copy is trunk-side by definition.
  if (entry.checkoutId === "main") {
    return parseDocFreshnessV1({ ...base(entry, docId), status: "ok", state: "main", message: null });
  }

  try {
    // 1. Dirty (modified, untracked, OR ignored) → uncommitted. `--ignored`
    // matters because DocsSource indexes the filesystem regardless of
    // .gitignore — an ignored doc must not read as clean and fall through
    // to a trunk state it was never committed to.
    const status = await deps.gitRun(entry.checkoutKey, ["--no-optional-locks", "status", "--porcelain", "--ignored", "--", entry.relPath]);
    if (status.code !== 0) {
      return parseDocFreshnessV1({ ...base(entry, docId), status: "git_error", state: null, message: "git status failed for this checkout." });
    }
    if (status.stdout.trim().length > 0) {
      return parseDocFreshnessV1({ ...base(entry, docId), status: "ok", state: "uncommitted", message: null });
    }

    // 2. Merged — the strongest state, checked FIRST so detached/no-upstream
    // checkouts still reach it. Two independent proofs:
    //   (a) content at HEAD == content at the trunk TIP (two-dot) — catches
    //       squash-merges, where trunk carries the content with new ancestry;
    //   (b) no branch-side changes vs the merge-base (three-dot) — the copy
    //       has nothing trunk lacks.
    const trunk = await resolveTrunkRef(deps.gitRun, entry.checkoutKey);
    if (trunk) {
      const vsTip = await deps.gitRun(entry.checkoutKey, ["diff", "--name-only", trunk, "HEAD", "--", entry.relPath]);
      if (vsTip.code !== 0) {
        return parseDocFreshnessV1({ ...base(entry, docId), status: "git_error", state: null, message: "git diff vs trunk failed." });
      }
      if (vsTip.stdout.trim().length === 0) {
        return parseDocFreshnessV1({ ...base(entry, docId), status: "ok", state: "merged", message: null });
      }
      const vsMergeBase = await deps.gitRun(entry.checkoutKey, ["diff", "--name-only", `${trunk}...HEAD`, "--", entry.relPath]);
      if (vsMergeBase.code !== 0) {
        return parseDocFreshnessV1({ ...base(entry, docId), status: "git_error", state: null, message: "git diff vs trunk failed." });
      }
      if (vsMergeBase.stdout.trim().length === 0) {
        return parseDocFreshnessV1({ ...base(entry, docId), status: "ok", state: "merged", message: null });
      }
    }

    // 3. Not merged: committed (ahead of upstream, or no upstream at all)
    // vs pushed (on the upstream).
    const upstream = await deps.gitRun(entry.checkoutKey, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    if (upstream.code !== 0) {
      return parseDocFreshnessV1({
        ...base(entry, docId),
        status: "ok",
        state: "committed",
        message: "Branch has no upstream — nothing pushed yet.",
      });
    }
    const ahead = await deps.gitRun(entry.checkoutKey, ["log", "--oneline", "@{upstream}..HEAD", "--", entry.relPath]);
    if (ahead.code === 0 && ahead.stdout.trim().length > 0) {
      return parseDocFreshnessV1({ ...base(entry, docId), status: "ok", state: "committed", message: null });
    }
    return parseDocFreshnessV1({
      ...base(entry, docId),
      status: "ok",
      state: "pushed",
      message: trunk ? null : "No trunk ref found in this checkout — cannot confirm merge.",
    });
  } catch (err) {
    return parseDocFreshnessV1({
      ...base(entry, docId),
      status: "git_error",
      state: null,
      message: err instanceof Error ? err.message : "git call failed",
    });
  }
}
