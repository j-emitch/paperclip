/**
 * `WorktreeSource` — per-worktree lifecycle state for the Branch·PR Worktrees
 * lens (COS-8c / spec §5.2). Emits one `WorktreeSignal` per non-primary
 * worktree of each configured repo, enumerated from `ctx.worktrees` (the same
 * shared checkout-key map the doc index reads through — checkoutKey is the
 * join key everywhere).
 *
 * READ-ONLY: every git verb is a pure read; `status` runs with the global
 * `--no-optional-locks` flag. Cost model (spec §5.2 activity gate):
 *   - CHEAP per tree, always: rev-parse HEAD / status / log -1 / rev-list
 *     counts / squash check (per-repo tree-hash set computed ONCE).
 *   - EXPENSIVE (merge-base diff → `changedFiles`): only for trees that are
 *     dirty OR tip-active (< WORKTREE_ACTIVE_DAYS), ALL DIRTY FIRST (two dirty
 *     conflicting trees must never lose their radar slot to a merely recent
 *     clean tree), then by tip recency; capped MAX_WORKTREE_DIFFS/repo under
 *     WORKTREE_BUDGET_MS. Skipped ⇒ `changedFiles: null` + a
 *     `worktree_diff_capped` error NAMING any skipped-dirty trees — the
 *     projection derives "evaluated N/M" from the null pattern.
 *
 * The `_purpose` Work Record (COH-0) is read from the PARENT repo's main
 * checkout (`.claude/worktrees/_purpose/<basename>.md`) — the declared status
 * source for lane semantics; git heuristics only fill Work-Record-absent
 * trees (spec §8.6 item 3). The COH squash detector is ported VERBATIM from
 * `coh-worktree.sh` (direct = ancestor of trunk; squash = branch tree-hash ∈
 * trunk's last-150d commit tree-hashes; else none), parameterized only by the
 * resolved trunk ref.
 */

import { signalError, type CollectionContext, type WorktreeCheckout } from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError, WorktreeSignal } from "../contracts/signals.js";
import type { WorktreeMergeStatus, WorktreeOrigin } from "../contracts/vocab.js";
import {
  MAX_WORKTREE_CHANGED_FILES,
  MAX_WORKTREE_DIFFS,
  SQUASH_DETECT_SINCE,
  WORKTREE_ACTIVE_DAYS,
  WORKTREE_BUDGET_MS,
} from "../contracts/worktree-board.js";
import { collectPerRepo, type RepoReadResult } from "./_shared.js";
import { TRUNK_CANDIDATES } from "./git-helpers.js";
import { parsePurposeRecord } from "./purpose.js";

export const WORKTREE_SOURCE_ID = "worktree";

const MS_PER_DAY = 86_400_000;
/** `_purpose` head-read cap — checkpoints lists are long but bounded. */
const PURPOSE_SCAN_BYTES = 65_536;

/** Auto-spawned worktree dir shape: `<adjective>-<name>-<hex6>` (claude convention). */
const CLAUDE_AUTO_DIR = /^[a-z]+-[a-z0-9]+-[0-9a-f]{6}$/;

/** Classify who spawned a tree — branch prefix first, then the dir-name shape. */
export function classifyOrigin(branch: string | null, name: string): WorktreeOrigin {
  if (branch?.startsWith("claude/")) return "claude";
  if (branch?.startsWith("codex/")) return "codex";
  if (CLAUDE_AUTO_DIR.test(name)) return "claude";
  return "external";
}

export const worktreeSource: WorkSignalSource = {
  id: WORKTREE_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    const byRepo = new Map<string, WorktreeCheckout[]>();
    for (const wt of ctx.worktrees) {
      const list = byRepo.get(wt.parentRepoKey) ?? [];
      list.push(wt);
      byRepo.set(wt.parentRepoKey, list);
    }

    return collectPerRepo(WORKTREE_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const wts = byRepo.get(repo.repo) ?? [];
      if (wts.length === 0) return { signals: [], errors: [] };
      return collectRepoWorktrees(c, repo.repo, wts);
    });
  },
};

interface TreeScan {
  wt: WorktreeCheckout;
  headSha: string | null;
  dirtyFileCount: number | null;
  lastCommitAt: string | null;
  ahead: number | null;
  behind: number | null;
  mergeStatus: WorktreeMergeStatus;
  purpose: WorktreeSignal["purpose"];
  changedFiles: string[] | null;
  changedFilesTruncated: boolean;
}

async function collectRepoWorktrees(
  ctx: CollectionContext,
  repoKey: string,
  wts: readonly WorktreeCheckout[],
): Promise<RepoReadResult> {
  const errors: SignalError[] = [];
  const startMs = ctx.clock.now();
  const overBudget = () => ctx.clock.now() - startMs > WORKTREE_BUDGET_MS;

  // Trunk + the per-repo squash tree-hash set (computed ONCE — coh-worktree.sh
  // reads it per branch; one log per repo is the same set).
  const trunk = await resolveTrunk(ctx, repoKey);
  const trunkTreeHashes = trunk ? await trunkTreeHashSet(ctx, repoKey, trunk) : null;

  // Pass 1 — cheap reads for EVERY tree (budget-checked between trees; a tree
  // past the budget degrades to nulls rather than vanishing).
  const scans: TreeScan[] = [];
  for (const wt of wts) {
    scans.push(await scanCheap(ctx, repoKey, wt, trunk, trunkTreeHashes, overBudget, errors));
  }

  // Pass 2 — the activity-gated expensive diff. Eligible: dirty OR tip-active.
  // ALL DIRTY FIRST, then clean-actives by tip recency (newest first).
  // No trunk ⇒ no merge-base basis exists for ANY tree: skip the pass with a
  // truthful degradation instead of burning the queue on no-op evaluations and
  // emitting a misleading "capped" error for trees nothing could evaluate.
  if (!trunk) {
    const signals: Signal[] = scans.map((s) => toSignal(repoKey, s));
    errors.push(
      signalError("git_read_failed", `no trunk ref resolved for ${repoKey} — changed-files evaluation skipped`, true),
    );
    return { signals, errors };
  }
  const nowMs = ctx.clock.now();
  const isActive = (s: TreeScan) =>
    s.lastCommitAt !== null && nowMs - Date.parse(s.lastCommitAt) < WORKTREE_ACTIVE_DAYS * MS_PER_DAY;
  const dirty = scans.filter((s) => (s.dirtyFileCount ?? 0) > 0);
  const cleanActive = scans
    .filter((s) => (s.dirtyFileCount ?? 0) === 0 && isActive(s))
    .sort((a, b) => Date.parse(b.lastCommitAt ?? "0") - Date.parse(a.lastCommitAt ?? "0"));
  const queue = [...dirty, ...cleanActive];

  let diffs = 0;
  const skipped: TreeScan[] = [];
  for (const scan of queue) {
    if (diffs >= MAX_WORKTREE_DIFFS || overBudget()) {
      skipped.push(scan);
      continue;
    }
    const evaluated = await evaluateChangedFiles(ctx, scan.wt, trunk, errors);
    scan.changedFiles = evaluated.files;
    scan.changedFilesTruncated = evaluated.truncated;
    diffs++;
  }
  if (skipped.length > 0) {
    const skippedDirty = skipped.filter((s) => (s.dirtyFileCount ?? 0) > 0).map((s) => s.wt.name);
    errors.push(
      signalError(
        "worktree_diff_capped",
        `worktree diff evaluation capped for ${repoKey} (${diffs}/${queue.length} eligible evaluated)` +
          (skippedDirty.length > 0 ? ` — SKIPPED DIRTY: ${skippedDirty.join(", ")}` : ""),
        false,
      ),
    );
  }

  const signals: Signal[] = scans.map((s) => toSignal(repoKey, s));
  return { signals, errors };
}

/** First trunk candidate that resolves to a commit in the MAIN checkout. */
async function resolveTrunk(ctx: CollectionContext, repoKey: string): Promise<string | null> {
  for (const candidate of TRUNK_CANDIDATES) {
    const r = await ctx.git.run(repoKey, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (r.code === 0) return candidate;
  }
  return null;
}

/**
 * The squash-detect input, VERBATIM from `coh_mainmerge_tree_hashes_for`:
 * trunk's commit TREE hashes over the last 150 days.
 */
async function trunkTreeHashSet(ctx: CollectionContext, repoKey: string, trunk: string): Promise<Set<string> | null> {
  const r = await ctx.git.run(repoKey, ["log", `--since=${SQUASH_DETECT_SINCE}`, "--pretty=format:%T", trunk]);
  if (r.code !== 0) return null;
  return new Set(r.stdout.split("\n").map((l) => l.trim()).filter(Boolean));
}

/**
 * VERBATIM port of `coh_branch_merge_status` (coh-worktree.sh:22-29),
 * parameterized by the resolved trunk: direct = ancestor of trunk; squash =
 * the tree's HEAD tree-hash matches a trunk commit tree; else none. Any
 * degraded read → `unknown` (never a false lane).
 */
async function mergeStatusOf(
  ctx: CollectionContext,
  repoKey: string,
  wt: WorktreeCheckout,
  trunk: string | null,
  trunkTrees: Set<string> | null,
): Promise<WorktreeMergeStatus> {
  if (!trunk) return "unknown";
  const compareRef = wt.branch ?? "HEAD";
  // `--end-of-options` hardens the argv boundary: a corrupt/low-level ref name
  // can never be parsed as an option (git refuses `-`-leading branch names, but
  // `worktree list` output is not the only writer of `.git` state).
  const ancestor = await ctx.git.run(wt.key, ["merge-base", "--is-ancestor", "--end-of-options", compareRef, trunk]);
  if (ancestor.code === 0) return "direct";
  // rc 1 is the legitimate "not an ancestor"; anything else (128 bad ref,
  // timeout null, corrupt tree) is a DEGRADED read — unknown, never a false "no".
  if (ancestor.code !== 1) return "unknown";
  if (!trunkTrees) return "unknown";
  const btree = await ctx.git.run(wt.key, ["rev-parse", "--end-of-options", `${compareRef}^{tree}`]);
  if (btree.code !== 0 || btree.stdout.trim() === "") return "unknown";
  return trunkTrees.has(btree.stdout.trim()) ? "squash" : "none";
}

async function scanCheap(
  ctx: CollectionContext,
  repoKey: string,
  wt: WorktreeCheckout,
  trunk: string | null,
  trunkTrees: Set<string> | null,
  overBudget: () => boolean,
  errors: SignalError[],
): Promise<TreeScan> {
  const base: TreeScan = {
    wt,
    headSha: null,
    dirtyFileCount: null,
    lastCommitAt: null,
    ahead: null,
    behind: null,
    mergeStatus: "unknown",
    purpose: null,
    changedFiles: null,
    changedFilesTruncated: false,
  };

  // The _purpose read is a contained fs read on the PARENT repo — do it even
  // when the git budget is gone (it is cheap and the Work Record is the lane
  // status source).
  base.purpose = await readPurpose(ctx, repoKey, wt.name);

  // Budget re-checked between VERBS, not just between trees — a single slow or
  // corrupt worktree must not run its full verb ladder (each verb can burn the
  // runner's whole per-call timeout) after the repo budget is spent.
  const budgetSpent = () => {
    if (!overBudget()) return false;
    errors.push(signalError("git_read_failed", `worktree budget exhausted mid-scan of ${wt.name}`, true));
    return true;
  };
  if (overBudget()) {
    errors.push(signalError("git_read_failed", `worktree budget exhausted before scanning ${wt.name}`, true));
    return base;
  }

  const head = await ctx.git.run(wt.key, ["rev-parse", "HEAD"]);
  if (head.code === 0) base.headSha = head.stdout.trim() || null;
  else errors.push(signalError("git_read_failed", `rev-parse HEAD failed in ${wt.name}`, true));
  if (budgetSpent()) return base;

  const status = await ctx.git.run(wt.key, ["--no-optional-locks", "status", "--porcelain"]);
  if (status.code === 0) base.dirtyFileCount = status.stdout.split("\n").filter((l) => l.trim() !== "").length;
  else errors.push(signalError("git_read_failed", `status failed in ${wt.name}`, true));
  if (budgetSpent()) return base;

  const log = await ctx.git.run(wt.key, ["log", "-1", "--format=%cI"]);
  if (log.code === 0) base.lastCommitAt = log.stdout.trim() || null;
  if (budgetSpent()) return base;

  if (trunk) {
    const counts = await ctx.git.run(wt.key, ["rev-list", "--left-right", "--count", `${trunk}...HEAD`]);
    if (counts.code === 0) {
      const m = counts.stdout.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) {
        base.behind = Number(m[1]);
        base.ahead = Number(m[2]);
      }
    }
    if (budgetSpent()) return base;
  }

  base.mergeStatus = await mergeStatusOf(ctx, repoKey, wt, trunk, trunkTrees);
  return base;
}

/** Merge-base diff, working-tree-inclusive (same basis as 8f's doc-diff). */
async function evaluateChangedFiles(
  ctx: CollectionContext,
  wt: WorktreeCheckout,
  trunk: string | null,
  errors: SignalError[],
): Promise<{ files: string[] | null; truncated: boolean }> {
  if (!trunk) return { files: null, truncated: false };
  const mb = await ctx.git.run(wt.key, ["merge-base", trunk, "HEAD"]);
  if (mb.code !== 0 || mb.stdout.trim() === "") {
    errors.push(signalError("git_read_failed", `merge-base failed in ${wt.name}`, true));
    return { files: null, truncated: false };
  }
  const diff = await ctx.git.run(wt.key, ["diff", "--name-only", mb.stdout.trim()]);
  if (diff.code !== 0) {
    errors.push(signalError("git_read_failed", `diff --name-only failed in ${wt.name}`, true));
    return { files: null, truncated: false };
  }
  const names = diff.stdout.split("\n").map((l) => l.trim()).filter(Boolean);

  // UNTRACKED files are part of a tree's footprint too — a brand-new spec or
  // handoff draft is exactly the doc the docs-updated chip exists for, and two
  // trees both adding the same new file is a real conflict-radar overlap. The
  // tracked diff can never show them (not in any commit), so union them in.
  const untracked = await ctx.git.run(wt.key, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked.code === 0) {
    const seen = new Set(names);
    for (const raw of untracked.stdout.split("\n")) {
      const name = raw.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  } else {
    errors.push(signalError("git_read_failed", `ls-files --others failed in ${wt.name}`, true));
  }

  if (names.length > MAX_WORKTREE_CHANGED_FILES) {
    return { files: names.slice(0, MAX_WORKTREE_CHANGED_FILES), truncated: true };
  }
  return { files: names, truncated: false };
}

/** Read + parse the COH-0 `_purpose` Work Record from the parent repo's main checkout. */
async function readPurpose(ctx: CollectionContext, repoKey: string, name: string): Promise<WorktreeSignal["purpose"]> {
  try {
    const head = await ctx.fs.readTextHead(repoKey, `.claude/worktrees/_purpose/${name}.md`, PURPOSE_SCAN_BYTES);
    return parsePurposeRecord(head);
  } catch {
    return null; // no _purpose file — heuristics fill lane semantics (spec §8.6)
  }
}

function toSignal(repoKey: string, s: TreeScan): WorktreeSignal {
  return {
    kind: "worktree",
    source: WORKTREE_SOURCE_ID,
    repo: repoKey,
    confidence: "high",
    freshness: "live",
    errors: [],
    checkoutKey: s.wt.key,
    checkoutId: s.wt.checkoutId,
    worktreeName: s.wt.name,
    branch: s.wt.branch,
    origin: classifyOrigin(s.wt.branch, s.wt.name),
    headSha: s.headSha,
    dirtyFileCount: s.dirtyFileCount,
    ahead: s.ahead,
    behind: s.behind,
    lastCommitAt: s.lastCommitAt,
    changedFiles: s.changedFiles,
    changedFilesTruncated: s.changedFilesTruncated,
    purpose: s.purpose,
    mergeStatus: s.mergeStatus,
  };
}
