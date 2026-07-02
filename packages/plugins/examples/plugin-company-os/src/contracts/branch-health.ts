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
 * are the only "high" (a conflicting branch blocks a merge); behind/stale/dirty/
 * unmerged-orphan are "medium" (need a look); the unevaluated/comparison-unavailable
 * flags are "low" (informational — we couldn't measure, not that it's bad); a clean
 * ahead branch is pure "info". Unchanged from the pre-5e `deriveOrientation` map.
 */
export const BRANCH_STATUS_SEVERITY: Record<BranchStatus, HealthSeverity> = {
  conflicting: "high",
  behind: "medium",
  stale: "medium",
  dirty: "medium",
  unmerged_orphan: "medium",
  orphaned_worktree: "low",
  comparison_unavailable: "low",
  conflict_not_evaluated: "low",
  ahead_clean: "info",
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
