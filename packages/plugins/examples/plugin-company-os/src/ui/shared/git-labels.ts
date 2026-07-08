/**
 * Shared git-state display vocabulary — the label + tone maps for branch-health
 * flags, branch-vs-trunk comparison states, repo availability, and (COS-5e) PR
 * review verdicts. The Branch·PR Health tab (the full per-branch audit) and the
 * Home branch-health glance both render these same flags, so the maps live here —
 * neither surface depends on the other, and a "behind" chip reads the same amber on
 * both. Pure data keyed off the canonical `vocab.ts` tuples; no JSX, no SDK runtime.
 */

import type { BranchComparison, BranchStatus, HealthSeverity, RepoAvailability, ReviewVerdict } from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";

/** Derived branch-health flags → terse chip labels (spec §7). */
export const BRANCH_STATUS_LABELS: Record<BranchStatus, string> = {
  conflicting: "conflicts",
  behind: "behind",
  stale: "stale",
  dirty: "dirty",
  unmerged_orphan: "unmerged",
  orphaned_worktree: "orphaned worktree",
  comparison_unavailable: "compare unavailable",
  conflict_not_evaluated: "conflict not checked",
  ahead_clean: "ahead",
  // COS-8a PR-action flags — the branch's open PRs demand something.
  pr_changes_requested: "changes requested",
  pr_ci_failing: "CI failing",
  pr_mergeable_blocked: "merge blocked",
  pr_review_required: "awaiting review",
};

/**
 * A semantic tone per branch-health flag. The neutral states
 * (`comparison_unavailable`/`conflict_not_evaluated`) are muted — never a false
 * red — and `ahead_clean` is a positive green. Used by the Source tab's chips;
 * the Home glance keeps its chips muted (the row already carries a severity tone).
 */
export const BRANCH_STATUS_TONES: Record<BranchStatus, string> = {
  conflicting: statusColors.danger,
  behind: statusColors.stale,
  stale: statusColors.cached,
  dirty: statusColors.cached,
  unmerged_orphan: statusColors.stale,
  orphaned_worktree: statusColors.danger,
  comparison_unavailable: tokens.muted,
  conflict_not_evaluated: tokens.muted,
  ahead_clean: statusColors.ship,
  pr_changes_requested: statusColors.stale,
  pr_ci_failing: statusColors.danger,
  pr_mergeable_blocked: statusColors.danger,
  pr_review_required: tokens.muted,
};

/** Whether ahead/behind/conflict could be computed vs trunk (spec §5.1). */
export const BRANCH_COMPARISON_LABELS: Record<BranchComparison, string> = {
  ok: "in sync",
  no_merge_base: "no merge base",
  missing_trunk: "no trunk",
  error: "compare failed",
};

/** Whether a configured repo root is a usable git repo at collection time (§5.2/§5.7). */
export const REPO_AVAILABILITY_LABELS: Record<RepoAvailability, string> = {
  ok: "available",
  missing: "not found on disk",
  non_git: "not a git repo",
};

export const REPO_AVAILABILITY_TONES: Record<RepoAvailability, string> = {
  ok: statusColors.ship,
  missing: tokens.muted,
  non_git: statusColors.cached,
};

/**
 * PR review verdict → terse pill label (COS-5e). `block` reads as "no-ship" (the
 * review culture's term for a blocking verdict); `unknown` = a report exists but its
 * verdict didn't parse (distinct from NO review, which the view renders as its own
 * muted "no review" cue, never a false green).
 */
export const REVIEW_VERDICT_LABELS: Record<ReviewVerdict, string> = {
  ship: "ship",
  proceed: "proceed",
  revise: "revise",
  block: "no-ship",
  unknown: "unclear",
};

/** Verdict tone — ship green, proceed cyan, revise amber, no-ship red, unclear muted. */
export const REVIEW_VERDICT_TONES: Record<ReviewVerdict, string> = {
  ship: statusColors.ship,
  proceed: statusColors.proceed,
  revise: statusColors.revise,
  block: statusColors.danger,
  unknown: statusColors.reviewUnknown,
};

/**
 * Branch-health severity → tone (color cue). Shared by the Home digest AND the
 * Branch·PR Health attention band (COS-5e) — one source of truth so a "high"
 * branch reads the same red on both. Pair with the LABEL for the non-color cue.
 */
export const HEALTH_SEVERITY_TONES: Record<HealthSeverity, string> = {
  high: statusColors.danger,
  medium: statusColors.stale,
  low: statusColors.proceed,
  info: statusColors.reviewUnknown,
};

/** The non-color severity cue (Joe's "severity by color AND a non-color cue"). */
export const HEALTH_SEVERITY_LABELS: Record<HealthSeverity, string> = {
  high: "At risk",
  medium: "Needs a look",
  low: "Minor",
  info: "FYI",
};

/**
 * Canonical severity magnitude for the BROWSER surfaces (higher is worse) — the
 * UI-side twin of the worker-side `branch-health` order. The severity VALUE itself
 * is projection-computed + persisted (`BranchGitV1.attentionSeverity`); this map is
 * only for presentation ordering, so both the Home glance and the Branch·PR band
 * rank identically. (The status→severity mapping stays single-source in
 * `contracts/branch-health`; the UI never re-derives it.)
 */
export const HEALTH_SEVERITY_ORDER: Record<HealthSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };

/** "Needs attention" — high or medium. The browser twin of the worker predicate. */
export function isAttentionSeverity(severity: HealthSeverity): boolean {
  return severity === "high" || severity === "medium";
}
