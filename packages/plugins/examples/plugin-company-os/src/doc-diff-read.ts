/**
 * `readDocDiff` — the worker side of the `doc-diff` handler (COS-8f T3): the
 * selected doc copy's unified diff vs TRUNK, working-tree-inclusive (diff from
 * the trunk merge-base to the bytes on disk — exactly what "how does this copy
 * differ from main" means for a live worktree doc). An untracked doc is a
 * whole-file-new diff (`--no-index` vs /dev/null). Payload capped at
 * `DOC_DIFF_MAX_BYTES` with an explicit truncation flag.
 *
 * Same defense ladder as `readDocFreshness`: index gate → typed
 * `checkout_gone` (§4.1 row 4) → bounded git, failures typed, never a throw.
 * The main-checkout copy diffs vs its own HEAD (uncommitted edits only).
 */

import { DOC_DIFF_MAX_BYTES, DOC_GIT_SCHEMA_VERSION, parseDocDiffV1, type DocDiffV1 } from "./contracts/doc-git.js";
import type { DocEntryV1 } from "./contracts/doc-index.js";
import { findDocEntry, resolveTrunkRef, type DocGitDeps } from "./doc-freshness-read.js";

function base(entry: DocEntryV1, docId: string): Omit<DocDiffV1, "status" | "kind" | "stat" | "diff" | "truncated" | "message"> {
  return {
    schemaVersion: DOC_GIT_SCHEMA_VERSION,
    docId,
    repoKey: entry.repoKey,
    relPath: entry.relPath,
    checkout: entry.worktreeName ?? "main",
  };
}

function capped(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  // Cut on a line boundary under the byte cap so the tail is never a torn line.
  let out = "";
  for (const line of text.split("\n")) {
    if (Buffer.byteLength(out, "utf8") + Buffer.byteLength(line, "utf8") + 1 > maxBytes) break;
    out += `${line}\n`;
  }
  return { text: out, truncated: true };
}

export async function readDocDiff(deps: DocGitDeps, companyId: string, docId: string, maxBytes: number = DOC_DIFF_MAX_BYTES): Promise<DocDiffV1> {
  const notIndexed = (id: string, message: string): DocDiffV1 =>
    parseDocDiffV1({
      schemaVersion: DOC_GIT_SCHEMA_VERSION,
      status: "not_indexed",
      docId: id,
      repoKey: "?",
      relPath: "?",
      checkout: "?",
      kind: null,
      stat: null,
      diff: null,
      truncated: false,
      message,
    });

  if (!docId) return notIndexed("?", "No document selected.");

  const index = await deps.readIndex(companyId);
  const entry = findDocEntry(index, docId);
  if (!entry) return notIndexed(docId, "This doc isn’t in the index — refresh the cockpit or pick a listed doc.");

  if (!deps.checkoutResolvable(entry.checkoutKey)) {
    return parseDocDiffV1({
      ...base(entry, docId),
      status: "checkout_gone",
      kind: null,
      stat: null,
      diff: null,
      truncated: false,
      message: "This checkout no longer exists — the worktree was removed since the last index.",
    });
  }

  const gitError = (message: string): DocDiffV1 =>
    parseDocDiffV1({ ...base(entry, docId), status: "git_error", kind: null, stat: null, diff: null, truncated: false, message });

  try {
    // Untracked → the whole file is new. `--no-index` exits 1 when a diff
    // exists, so 0|1 are both success for diff-producing calls below.
    const tracked = await deps.gitRun(entry.checkoutKey, ["ls-files", "--error-unmatch", "--", entry.relPath]);
    if (tracked.code !== 0) {
      const whole = await deps.gitRun(entry.checkoutKey, ["diff", "--no-index", "--", "/dev/null", entry.relPath]);
      if (whole.code !== 0 && whole.code !== 1) return gitError("git diff --no-index failed for the untracked doc.");
      const { text, truncated } = capped(whole.stdout, maxBytes);
      return parseDocDiffV1({
        ...base(entry, docId),
        status: "ok",
        kind: "untracked_new",
        stat: null,
        diff: text,
        truncated,
        message: null,
      });
    }

    // Diff base: trunk merge-base for a worktree copy; HEAD for the main copy
    // (its committed bytes ARE trunk — only uncommitted edits can differ).
    let diffBase = "HEAD";
    if (entry.checkoutId !== "main") {
      const trunk = await resolveTrunkRef(deps.gitRun, entry.checkoutKey);
      if (!trunk) return gitError("No trunk ref found in this checkout — cannot diff vs trunk.");
      const mb = await deps.gitRun(entry.checkoutKey, ["merge-base", trunk, "HEAD"]);
      if (mb.code !== 0 || mb.stdout.trim().length === 0) return gitError("git merge-base vs trunk failed.");
      diffBase = mb.stdout.trim();
    }

    const [stat, diff] = await Promise.all([
      deps.gitRun(entry.checkoutKey, ["diff", "--stat", diffBase, "--", entry.relPath]),
      deps.gitRun(entry.checkoutKey, ["diff", diffBase, "--", entry.relPath]),
    ]);
    if ((stat.code !== 0 && stat.code !== 1) || (diff.code !== 0 && diff.code !== 1)) {
      return gitError("git diff vs trunk failed.");
    }

    if (diff.stdout.trim().length === 0) {
      return parseDocDiffV1({
        ...base(entry, docId),
        status: "ok",
        kind: "unchanged",
        stat: null,
        diff: null,
        truncated: false,
        message: null,
      });
    }

    const { text, truncated } = capped(diff.stdout, maxBytes);
    return parseDocDiffV1({
      ...base(entry, docId),
      status: "ok",
      kind: "diff",
      stat: stat.stdout.trim() || null,
      diff: text,
      truncated,
      message: null,
    });
  } catch (err) {
    return gitError(err instanceof Error ? err.message : "git call failed");
  }
}
