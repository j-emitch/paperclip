/**
 * `BranchSource` — per-branch + per-repo git state for the Source + Home
 * surfaces (spec §5.2). Emits, per configured repo root: ONE `RepoGitSignal`
 * (always — even for a missing/non-git root, so absent repos render honestly),
 * then ONE `BranchSignal` per local branch and ONE `branch: null` signal per
 * detached/orphaned worktree.
 *
 * READ-ONLY over product repos (spec §9): every git verb is a pure read —
 * `for-each-ref` / `worktree list` / `rev-parse` / `merge-base` / `rev-list` /
 * `log` write nothing; `status` runs with the GLOBAL `--no-optional-locks` flag
 * to suppress its index-refresh write; conflict prediction uses the non-writing
 * legacy three-arg `git merge-tree <base> <a> <b>` (the `--write-tree` form,
 * which writes a tree object, is BANNED). Cost-bounded: `MAX_CONFLICT_CHECKS`
 * + `REPO_GIT_BUDGET_MS`; budget exhaustion nulls expensive fields but NEVER
 * drops a branch row once the cheap enumeration succeeds. If the cheap
 * enumeration itself fails, the repo degrades to an explicit "git read failed"
 * state — honest, never a false "all clean."
 *
 * Signals carry `repo` (the repoKey) only — `projectKey` is resolved at
 * projection time (PF-5).
 */

import {
  reposResponsibleFor,
  type CollectionContext,
  type RepoRoot,
} from "../contracts/collection-context.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { RepoFreshness, SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type {
  BranchSignal,
  CommitRef,
  RepoGitSignal,
  Signal,
  SignalError,
  TrunkRef,
  WorktreeRef,
} from "../contracts/signals.js";
import type { BranchComparison, BranchStatus, RepoAvailability, SignalFreshness } from "../contracts/vocab.js";
import { BEHIND_WARN, MAX_CONFLICT_CHECKS, RECENT_COMMITS_PER_BRANCH, REPO_GIT_BUDGET_MS, STALE_WARN } from "../contracts/git-state.js";
import { errorFromSubprocess, nowIso } from "./_shared.js";
import { TRUNK_CANDIDATES, parseWorktreeList, type Worktree } from "./git-helpers.js";
import { BRANCH_LOG_FORMAT, FOR_EACH_REF_FORMAT, parseBranchCommits, parseForEachRef } from "./parse.js";

export const BRANCH_SOURCE_ID = "branch";

const MS_PER_DAY = 86_400_000;

export const branchSource: WorkSignalSource = {
  id: BRANCH_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    const signals: Signal[] = [];
    const repoFreshness: RepoFreshness[] = [];

    // NB: not `collectPerRepo` — that skips unavailable repos, but BranchSource
    // must emit a RepoGitSignal for an absent repo too (so deriveGitState renders
    // it honestly). We iterate the responsible set directly.
    for (const repo of reposResponsibleFor(ctx)) {
      const { repoSignals, errors } = await collectRepo(repo, ctx);
      signals.push(...repoSignals);
      const degraded = errors.some((e) => e.degraded);
      repoFreshness.push({
        repo: repo.repo,
        freshness: degraded ? "stale" : "live",
        lastOkAt: degraded ? null : nowIso(ctx),
        errors,
      });
    }

    return { source: BRANCH_SOURCE_ID, collectedAt, signals, repoFreshness };
  },
};

// ---------------------------------------------------------------------------
// Per-repo collection
// ---------------------------------------------------------------------------

interface BranchWork {
  branch: string | null;
  headSha: string;
  /** branch name, or headSha for a detached worktree — the comparison ref. */
  refForCompare: string;
  worktrees: WorktreeRef[];
  comparison: BranchComparison;
  ahead: number | null;
  behind: number | null;
  mergeBase: string | null;
  conflictsWithTrunk: boolean | null;
  lastCommitAt: string;
  staleDays: number;
  recentCommits: CommitRef[];
  /** True when the budget was exhausted before this branch's expensive reads. */
  degraded: boolean;
}

async function collectRepo(
  repo: RepoRoot,
  ctx: CollectionContext,
): Promise<{ repoSignals: Signal[]; errors: SignalError[] }> {
  const errors: SignalError[] = [];
  const diagnostics: Diagnostic[] = [];

  // 1. Reachability — an unavailable repo emits a single header signal, no branches.
  if (!repo.available) {
    const availability = await probeUnavailable(repo.repo, ctx);
    return {
      repoSignals: [repoGitSignal(repo.repo, availability, { ref: null, state: "missing" }, diagnostics, "live")],
      errors,
    };
  }

  // 2. Trunk resolution.
  const trunk = await resolveTrunk(repo.repo, ctx);
  if (trunk.state === "missing") {
    diagnostics.push(diag("info", "trunk_missing", `no trunk ref resolved for ${repo.repo}`, repo.repo));
  }

  // 3 + 4. Cheap one-shot enumeration (branches + worktrees).
  const ref = await ctx.git.run(repo.repo, ["for-each-ref", `--format=${FOR_EACH_REF_FORMAT}`, "refs/heads"]);
  const refErr = errorFromSubprocess(ref, "git for-each-ref");
  const wtRes = await ctx.git.run(repo.repo, ["worktree", "list", "--porcelain"]);
  const wtErr = errorFromSubprocess(wtRes, "git worktree list");

  // If the cheap enumeration ITSELF fails → honest degraded state (no rows, no false clean).
  if (refErr || wtErr) {
    const e = refErr ?? wtErr!;
    errors.push(e);
    diagnostics.push(diag("error", "git_enumeration_failed", `git enumeration failed for ${repo.repo}: ${e.message}`, repo.repo));
    return { repoSignals: [repoGitSignal(repo.repo, "ok", trunk, diagnostics, "stale")], errors };
  }

  const branchRefs = parseForEachRef(ref.stdout);
  const worktrees = parseWorktreeList(wtRes.stdout);

  // Map branch → its worktrees; collect detached/orphaned worktrees separately.
  const wtByBranch = new Map<string, Worktree[]>();
  const detached: Worktree[] = [];
  for (const wt of worktrees) {
    if (wt.branch === null || wt.detached) {
      detached.push(wt);
      continue;
    }
    const list = wtByBranch.get(wt.branch) ?? [];
    list.push(wt);
    wtByBranch.set(wt.branch, list);
  }

  const startMs = ctx.clock.now();
  const overBudget = () => ctx.clock.now() - startMs > REPO_GIT_BUDGET_MS;
  const nowMs = ctx.clock.now();

  const works: BranchWork[] = [];

  for (const br of branchRefs) {
    works.push(
      await buildBranchWork(repo.repo, br.branch, br.headSha, br.committedAt, wtByBranch.get(br.branch) ?? [], trunk, ctx, nowMs, overBudget()),
    );
  }
  for (const wt of detached) {
    works.push(await buildBranchWork(repo.repo, null, wt.head ?? "", null, [wt], trunk, ctx, nowMs, overBudget()));
  }

  // Conflict pass: only ahead-AND-behind branches with a merge-base, most-behind
  // first, capped at MAX_CONFLICT_CHECKS. Everything else keeps its provisional
  // value (false for ahead-only/behind-only/in-sync, null otherwise).
  if (trunk.state === "ok" && trunk.ref) {
    const pending = works
      .filter((w) => w.comparison === "ok" && w.mergeBase !== null && (w.ahead ?? 0) > 0 && (w.behind ?? 0) > 0 && !w.degraded)
      .sort((a, b) => (b.behind ?? 0) - (a.behind ?? 0));
    let checks = 0;
    let capped = false;
    for (const w of pending) {
      if (checks >= MAX_CONFLICT_CHECKS || overBudget()) {
        capped = true;
        break; // remaining stay at provisional null → "conflict_not_evaluated"
      }
      w.conflictsWithTrunk = await predictConflict(repo.repo, trunk.ref, w.mergeBase!, w.refForCompare, ctx);
      checks++;
    }
    if (capped) {
      diagnostics.push(diag("info", "conflict_check_capped", `conflict prediction capped at ${MAX_CONFLICT_CHECKS} for ${repo.repo}`, repo.repo));
    }
  }

  if (works.some((w) => w.degraded)) {
    diagnostics.push(diag("warn", "git_budget_exceeded", `git budget (${REPO_GIT_BUDGET_MS}ms) exceeded for ${repo.repo} — expensive fields nulled`, repo.repo));
  }

  const repoSignals: Signal[] = [repoGitSignal(repo.repo, "ok", trunk, diagnostics, "live")];
  for (const w of works) repoSignals.push(toBranchSignal(repo.repo, w, trunk));
  return { repoSignals, errors };
}

/** Build one branch (or detached-worktree) work record, respecting the budget. */
async function buildBranchWork(
  repo: string,
  branch: string | null,
  headSha: string,
  committedAt: string | null,
  wts: readonly Worktree[],
  trunk: TrunkRef,
  ctx: CollectionContext,
  nowMs: number,
  budgetGone: boolean,
): Promise<BranchWork> {
  const refForCompare = branch ?? headSha;

  // Cheap skeleton fields (always present once enumeration succeeded).
  const base: BranchWork = {
    branch,
    headSha,
    refForCompare,
    worktrees: wts.map((wt) => ({ path: wt.path, headSha: wt.head ?? "", detached: wt.detached, dirtyFileCount: null })),
    comparison: trunk.state === "ok" ? "ok" : "missing_trunk",
    ahead: null,
    behind: null,
    mergeBase: null,
    conflictsWithTrunk: trunk.state === "ok" ? false : null,
    lastCommitAt: committedAt ?? "",
    staleDays: committedAt ? staleDaysFrom(committedAt, nowMs) : 0,
    recentCommits: [],
    degraded: false,
  };

  if (budgetGone || refForCompare === "") {
    // Budget exhausted before this branch — keep the skeleton, null the rest.
    base.comparison = "error";
    base.conflictsWithTrunk = null;
    base.degraded = budgetGone;
    base.worktrees = base.worktrees.map((wt) => ({ ...wt, dirtyFileCount: null }));
    return base;
  }

  // Expensive per-branch reads.
  const cmp = await computeComparison(repo, trunk, refForCompare, ctx);
  base.comparison = cmp.comparison;
  base.ahead = cmp.ahead;
  base.behind = cmp.behind;
  base.mergeBase = cmp.mergeBase;
  // Provisional conflict: in-sync/ahead-only/behind-only cannot conflict → false;
  // comparison !== "ok" → null; ahead-AND-behind → null (resolved in the conflict pass).
  if (cmp.comparison !== "ok") base.conflictsWithTrunk = null;
  else if ((cmp.ahead ?? 0) === 0 || (cmp.behind ?? 0) === 0) base.conflictsWithTrunk = false;
  else base.conflictsWithTrunk = null;

  base.recentCommits = await readRecentCommits(repo, refForCompare, ctx);
  if (base.lastCommitAt === "" && base.recentCommits.length > 0) {
    base.lastCommitAt = base.recentCommits[0].committedAt;
    base.staleDays = staleDaysFrom(base.lastCommitAt, nowMs);
  }

  // Per-worktree dirty state — read-only `--no-optional-locks status --porcelain`.
  base.worktrees = await Promise.all(
    base.worktrees.map(async (wt) => ({ ...wt, dirtyFileCount: await dirtyCount(repo, wt.path, ctx) })),
  );

  return base;
}

// ---------------------------------------------------------------------------
// Git verbs (all pure reads)
// ---------------------------------------------------------------------------

/** Distinguish a missing dir from an existing-but-non-git dir (PF-6). */
async function probeUnavailable(repo: string, ctx: CollectionContext): Promise<RepoAvailability> {
  const res = await ctx.git.run(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (res.code === 0) return "ok"; // unexpected (available was false) but report honestly
  const stderr = res.stderr.toLowerCase();
  if (/enoent|no such file|cannot find|does not exist/.test(stderr)) return "missing";
  if (/not a git repository|not a working tree/.test(stderr)) return "non_git";
  return "missing";
}

/** First existing trunk candidate → TrunkRef; none → {ref:null, state:"missing"}. */
async function resolveTrunk(repo: string, ctx: CollectionContext): Promise<TrunkRef> {
  for (const ref of TRUNK_CANDIDATES) {
    const res = await ctx.git.run(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (res.code === 0 && res.stdout.trim() !== "") return { ref, state: "ok" };
  }
  return { ref: null, state: "missing" };
}

async function computeComparison(
  repo: string,
  trunk: TrunkRef,
  ref: string,
  ctx: CollectionContext,
): Promise<{ comparison: BranchComparison; ahead: number | null; behind: number | null; mergeBase: string | null }> {
  if (trunk.state !== "ok" || trunk.ref === null) {
    return { comparison: "missing_trunk", ahead: null, behind: null, mergeBase: null };
  }
  const mb = await ctx.git.run(repo, ["merge-base", trunk.ref, ref]);
  const mergeBase = mb.code === 0 ? mb.stdout.trim() : "";
  if (mergeBase === "") return { comparison: "no_merge_base", ahead: null, behind: null, mergeBase: null };

  const rl = await ctx.git.run(repo, ["rev-list", "--left-right", "--count", `${trunk.ref}...${ref}`]);
  if (rl.code !== 0) return { comparison: "error", ahead: null, behind: null, mergeBase };
  // `--left-right --count A...B` → "<behind>\t<ahead>" (left = in A not B = behind).
  const [behindStr, aheadStr] = rl.stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindStr ?? "", 10);
  const ahead = Number.parseInt(aheadStr ?? "", 10);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    return { comparison: "error", ahead: null, behind: null, mergeBase };
  }
  return { comparison: "ok", ahead, behind, mergeBase };
}

async function readRecentCommits(repo: string, ref: string, ctx: CollectionContext): Promise<CommitRef[]> {
  const res = await ctx.git.run(repo, [
    "log",
    "-n",
    String(RECENT_COMMITS_PER_BRANCH),
    "--shortstat",
    `--format=${BRANCH_LOG_FORMAT}`,
    ref,
  ]);
  if (res.code !== 0) return [];
  return parseBranchCommits(res.stdout);
}

/** Per-worktree dirty count via the read-only global `--no-optional-locks status --porcelain`. */
async function dirtyCount(repo: string, wtPath: string, ctx: CollectionContext): Promise<number | null> {
  // The exact argv: `-C <path>` + `--no-optional-locks` are BOTH global flags
  // (before the `status` subcommand). `git status --no-optional-locks` is invalid
  // (the flag is global), so the order here is load-bearing.
  const res = await ctx.git.run(repo, ["-C", wtPath, "--no-optional-locks", "status", "--porcelain"]);
  if (res.code !== 0) return null;
  return res.stdout.split(/\r?\n/).filter((l) => l.trim() !== "").length;
}

/** Read-only conflict prediction via the legacy three-arg `merge-tree`; null when unevaluable. */
async function predictConflict(
  repo: string,
  trunkRef: string,
  mergeBase: string,
  ref: string,
  ctx: CollectionContext,
): Promise<boolean | null> {
  const res = await ctx.git.run(repo, ["merge-tree", mergeBase, trunkRef, ref]);
  if (res.code !== 0) return null; // legacy form unavailable / errored → can't evaluate
  return /<{7}/.test(res.stdout); // conflict markers present
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function staleDaysFrom(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / MS_PER_DAY));
}

function diag(level: Diagnostic["level"], code: string, message: string, repo: string | null): Diagnostic {
  return { level, code, message, repo, source: BRANCH_SOURCE_ID };
}

function repoGitSignal(
  repo: string,
  availability: RepoAvailability,
  trunk: TrunkRef,
  diagnostics: Diagnostic[],
  freshness: SignalFreshness,
): RepoGitSignal {
  return {
    kind: "repo_git",
    source: BRANCH_SOURCE_ID,
    repo,
    confidence: availability === "ok" ? "high" : "medium",
    freshness,
    errors: [],
    availability,
    trunk,
    diagnostics,
  };
}

function toBranchSignal(repo: string, w: BranchWork, trunk: TrunkRef): BranchSignal {
  return {
    kind: "branch",
    source: BRANCH_SOURCE_ID,
    repo,
    confidence: w.degraded ? "medium" : "high",
    freshness: w.degraded ? "stale" : "live",
    errors: [],
    branch: w.branch,
    headSha: w.headSha,
    worktrees: w.worktrees,
    trunk,
    comparison: w.comparison,
    ahead: w.ahead,
    behind: w.behind,
    conflictsWithTrunk: w.conflictsWithTrunk,
    lastCommitAt: w.lastCommitAt,
    staleDays: w.staleDays,
    recentCommits: w.recentCommits,
    statuses: computeStatuses(w),
  };
}

/** §7 derived branch-health flags (a branch can carry several). */
function computeStatuses(w: BranchWork): BranchStatus[] {
  const s: BranchStatus[] = [];
  const ok = w.comparison === "ok";
  const dirty = w.worktrees.some((wt) => (wt.dirtyFileCount ?? 0) > 0);
  if (ok && w.conflictsWithTrunk === true) s.push("conflicting");
  if (ok && w.behind !== null && w.behind > BEHIND_WARN) s.push("behind");
  if (w.staleDays > STALE_WARN) s.push("stale");
  if (dirty) s.push("dirty");
  if (ok && w.ahead === 0 && w.behind !== null && w.behind > 0 && w.staleDays > STALE_WARN) s.push("unmerged_orphan");
  if (w.branch === null) s.push("orphaned_worktree");
  if (!ok) s.push("comparison_unavailable");
  if (ok && (w.ahead ?? 0) > 0 && (w.behind ?? 0) > 0 && w.conflictsWithTrunk === null) s.push("conflict_not_evaluated");
  if (ok && (w.ahead ?? 0) > 0 && w.behind === 0 && w.conflictsWithTrunk !== true && !dirty) s.push("ahead_clean");
  return s;
}
