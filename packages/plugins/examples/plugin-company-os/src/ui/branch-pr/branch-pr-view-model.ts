/**
 * Pure Branch·PR Health view-model — the only place this surface computes anything.
 *
 * Everything here is a pure function of `GitStateV1` (the enriched Source payload:
 * per-branch git state + joined open-PR lifecycle + review state, COS-5e). The TSX
 * renders this verbatim. Honours the COS-0 import boundary: contract TYPES only —
 * no zod, no sources, no Node.
 *
 * The "needs attention" band reads each branch's `attentionSeverity` — computed ONCE
 * in `deriveGitState` via the SAME `branchStatusSeverity` that `deriveOrientation`
 * builds Home's `branchHealth` from, then persisted. So this surface's attention count
 * is provably identical to Home's "N branches need attention" link (same source
 * function, same branch set: branch signals only exist for available repos, which is
 * exactly what git-state carries) — and the browser never value-imports the severity
 * function (the COS-0 import boundary: contracts are type-only in the UI). PR review
 * verdicts are a SEPARATE health axis (a blocking review on a git-clean branch),
 * surfaced as their own callout so neither count silently absorbs the other.
 */

import type {
  BranchGitV1,
  BranchPrV1,
  GitStateV1,
  RepoGitStateV1,
} from "../../contracts/index.js";
import type { BranchStatus, HealthSeverity, ReviewVerdict } from "../../contracts/vocab.js";
import { HEALTH_SEVERITY_ORDER, isAttentionSeverity } from "../shared/git-labels.js";

/** At-a-glance vitals for the masthead. */
export interface BranchPrVitals {
  /** Repos that are present on disk (availability === "ok"). */
  repoCount: number;
  branchCount: number;
  /** All open PRs (attached to a branch + orphaned), across every repo. */
  openPrCount: number;
  /** Open PRs with a head-current review report (the report pertains to what's open now). */
  reviewedPrCount: number;
  /** Branches flagged by git-status severity (high/medium) — matches Home's count. */
  needsAttentionCount: number;
  /** Open PRs whose head ref matches no local branch. */
  orphanPrCount: number;
}

/** One at-risk branch in the attention band (worst-first). */
export interface AttentionRow {
  repoKey: string;
  branch: string | null;
  severity: HealthSeverity;
  statuses: BranchStatus[];
  behind: number | null;
  staleDays: number;
  /** The primary open PR on this branch, if any (for a compact PR cue in the band). */
  prNumber: number | null;
  reviewVerdict: ReviewVerdict | null;
}

/** One open PR flagged by a current blocking/revise review — the second health axis. */
export interface FlaggedReviewRow {
  repoKey: string;
  branch: string | null;
  pr: BranchPrV1;
}

export interface BranchPrView {
  vitals: BranchPrVitals;
  /** Git-status at-risk branches, worst-severity-first then most-behind. */
  attention: AttentionRow[];
  /** Open PRs whose CURRENT review verdict is blocking (`block`) or `revise`. */
  flaggedReviews: FlaggedReviewRow[];
}

/** The primary open PR on a branch — newest-updated (the git-state sort), else null. */
export function primaryPr(branch: BranchGitV1): BranchPrV1 | null {
  return branch.pullRequests.length > 0 ? branch.pullRequests[0] : null;
}

/** Every available repo across all project groups (absent 0-rows excluded). */
function availableRepos(gitState: GitStateV1): RepoGitStateV1[] {
  return gitState.groups.flatMap((g) => g.repos).filter((r) => r.availability === "ok");
}

/** Every open PR: each branch's PRs + each repo's orphan PRs (no double counting). */
function allPrs(repos: readonly RepoGitStateV1[]): { pr: BranchPrV1; repoKey: string; branch: string | null }[] {
  const out: { pr: BranchPrV1; repoKey: string; branch: string | null }[] = [];
  for (const repo of repos) {
    for (const branch of repo.branches) {
      for (const pr of branch.pullRequests) out.push({ pr, repoKey: repo.repoKey, branch: branch.branch });
    }
    for (const pr of repo.orphanPullRequests) out.push({ pr, repoKey: repo.repoKey, branch: null });
  }
  return out;
}

export function buildBranchPrView(gitState: GitStateV1): BranchPrView {
  const repos = availableRepos(gitState);
  const prs = allPrs(repos);

  // Attention band: read the persisted `attentionSeverity` (projection-computed via
  // the shared branch-health fn) — identical to Home's selection; worst-first, then
  // most-behind.
  const attention: AttentionRow[] = repos
    .flatMap((repo) => repo.branches.map((branch) => ({ repo, branch })))
    .map(({ repo, branch }): { severity: HealthSeverity; row: AttentionRow } => {
      const severity = branch.attentionSeverity;
      const pr = primaryPr(branch);
      return {
        severity,
        row: {
          repoKey: repo.repoKey,
          branch: branch.branch,
          severity,
          statuses: [...branch.statuses],
          behind: branch.behind,
          staleDays: branch.staleDays,
          prNumber: pr?.prNumber ?? null,
          reviewVerdict: pr?.review?.verdict ?? null,
        },
      };
    })
    .filter((x) => isAttentionSeverity(x.severity))
    .sort((a, b) => HEALTH_SEVERITY_ORDER[b.severity] - HEALTH_SEVERITY_ORDER[a.severity] || (b.row.behind ?? 0) - (a.row.behind ?? 0))
    .map((x) => x.row);

  // Second axis: open PRs whose CURRENT review is blocking/revise (git-clean or not).
  const flaggedReviews: FlaggedReviewRow[] = prs
    .filter(({ pr }) => pr.review !== null && pr.review.current && isFlaggedVerdict(pr.review.verdict))
    .map(({ pr, repoKey, branch }) => ({ repoKey, branch, pr }));

  const reviewedPrCount = prs.filter(({ pr }) => pr.review !== null && pr.review.current).length;
  const orphanPrCount = repos.reduce((sum, r) => sum + r.orphanPullRequests.length, 0);

  return {
    vitals: {
      repoCount: repos.length,
      branchCount: repos.reduce((sum, r) => sum + r.branches.length, 0),
      openPrCount: prs.length,
      reviewedPrCount,
      needsAttentionCount: attention.length,
      orphanPrCount,
    },
    attention,
    flaggedReviews,
  };
}

/** A blocking review verdict — the second health axis surfaces these. */
export function isFlaggedVerdict(verdict: ReviewVerdict): boolean {
  return verdict === "block" || verdict === "revise";
}

/**
 * True only when there is genuinely nothing to show — no configured repo produced a
 * row at all. A repo with zero branches is NOT empty (it renders its 0-state); the
 * cold cache (a null gitState) is the caller's EmptyState path.
 */
export function isBranchPrEmpty(gitState: GitStateV1): boolean {
  return gitState.groups.every((g) => g.repos.length === 0);
}
