/**
 * Shared git-state display vocabulary — the label + tone maps for branch-health
 * flags, branch-vs-trunk comparison states, and repo availability. The Source tab
 * (the full per-branch audit) and the Home branch-health glance both render these
 * same flags, so the maps live here — neither surface depends on the other, and a
 * "behind" chip reads the same amber on both. Pure data keyed off the canonical
 * `vocab.ts` tuples; no JSX, no SDK runtime.
 */

import type { BranchComparison, BranchStatus, RepoAvailability } from "../../contracts/vocab.js";
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
