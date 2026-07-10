/**
 * Branch-health severity — the ONE definition of "how alarming is this branch",
 * shared by the Home digest projection (`deriveOrientation` builds its
 * alert-worthy `branchHealth` from it) AND the Branch·PR Health view-model (which
 * flags + orders the full per-branch tree with it). Before COS-5e this math lived
 * privately inside `deriveOrientation`; elevating the Source tab into a dedicated
 * Branch·PR Health section meant a second consumer, so it moved here to a pure,
 * zod-free contract module — keeping Home's "N need attention" count and the
 * Branch·PR view's per-row accent provably in lock-step (they cannot drift when
 * they read the same function).
 *
 * Pure + dependency-free (vocab tuples only): safe to import from projections AND
 * from browser view-models under the COS-0 import boundary.
 */

import type { BranchStatus, HealthSeverity } from "./vocab.js";

/**
 * Per-status severity. A branch's severity is the WORST of its statuses. Conflicts
 * are the only "high" (a conflicting branch blocks a merge); behind (now fired only
 * while ACTIVE — see contracts/triage.ts) and dirty are "medium" (need a look);
 * stale/unmerged-orphan are "low" as of COS-8e (cleanup-queue items — the K7
 * alert-noise decision: dozens of old tips flooding the attention band drowned the
 * real alerts); the unevaluated/comparison-unavailable flags are "low"
 * (informational — we couldn't measure, not that it's bad); a clean ahead branch
 * is pure "info". Threshold values + the K7 rationale live in contracts/triage.ts.
 */
export const BRANCH_STATUS_SEVERITY: Record<BranchStatus, HealthSeverity> = {
  conflicting: "high",
  behind: "medium",
  stale: "low",
  dirty: "medium",
  unmerged_orphan: "low",
  orphaned_worktree: "low",
  comparison_unavailable: "low",
  conflict_not_evaluated: "low",
  ahead_clean: "info",
  // COS-8a PR-action statuses: warn-class (medium) for the three that block a
  // merge or demand a fix; awaiting-review is informational (low) — Home's
  // attention band must not fill with every PR that simply hasn't been read yet.
  pr_changes_requested: "medium",
  pr_ci_failing: "medium",
  pr_mergeable_blocked: "medium",
  pr_review_required: "low",
};

/** Canonical severity magnitude — higher is worse. The single ordering both surfaces rank by. */
export const HEALTH_SEVERITY_ORDER: Record<HealthSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** The worst severity across a branch's statuses; `info` when there is nothing to flag. */
export function branchStatusSeverity(statuses: readonly BranchStatus[]): HealthSeverity {
  let worst: HealthSeverity = "info";
  for (const s of statuses) {
    if (HEALTH_SEVERITY_ORDER[BRANCH_STATUS_SEVERITY[s]] > HEALTH_SEVERITY_ORDER[worst]) {
      worst = BRANCH_STATUS_SEVERITY[s];
    }
  }
  return worst;
}

/**
 * "Needs attention" = high or medium — the exact predicate `deriveOrientation`
 * uses to select alert-worthy branches for Home, exported so the Branch·PR view's
 * attention band selects the identical set (Home count ≡ Branch·PR band count).
 */
export function isAttentionSeverity(severity: HealthSeverity): boolean {
  return severity === "high" || severity === "medium";
}

/** Worst-severity-first comparator (a before b when a is more severe). */
export function compareSeverityWorstFirst(a: HealthSeverity, b: HealthSeverity): number {
  return HEALTH_SEVERITY_ORDER[b] - HEALTH_SEVERITY_ORDER[a];
}

/** The PR fields the action fold reads — structural, so BOTH projections (git-state
 * rows, orientation signals) can pass their own shapes. */
export interface PrActionInput {
  readonly isDraft: boolean;
  readonly ciState: string;
  readonly mergeableState: string;
  readonly reviewDecision: string;
}

/**
 * COS-8a: the PR-action statuses one branch accrues from its open PRs — the ONE
 * fold both `deriveGitState` (Branch·PR rows) and `deriveOrientation` (Home
 * alerts) call, so the tab rail and Home cannot disagree. Draft PRs keep the
 * CI/merge signals (the author is actively pushing) but suppress the review
 * states (nobody is asked to review a draft).
 */
export function prActionStatuses(prs: readonly PrActionInput[]): BranchStatus[] {
  const out = new Set<BranchStatus>();
  for (const pr of prs) {
    if (pr.ciState === "fail") out.add("pr_ci_failing");
    if (pr.mergeableState === "conflicting") out.add("pr_mergeable_blocked");
    if (!pr.isDraft && pr.reviewDecision === "changes_requested") out.add("pr_changes_requested");
    if (!pr.isDraft && pr.reviewDecision === "review_required") out.add("pr_review_required");
  }
  return [...out];
}
