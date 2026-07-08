/**
 * COS-8c worktree-board constants (the `WorktreeBoardV1` projection schema
 * joins this file in the T2 slice). Tuning knobs for `WorktreeSource`'s
 * activity gate — see spec §5.2: changedFiles are evaluated only for dirty or
 * recently-active trees, ALL DIRTY first, under a per-repo cap + time budget.
 */

/** A tree counts "active" when its tip is younger than this (days). */
export const WORKTREE_ACTIVE_DAYS = 21 as const;

/** Max changedFiles evaluations per repo per collect. */
export const MAX_WORKTREE_DIFFS = 32 as const;

/** Per-repo wall-clock budget for the whole worktree scan (ms). */
export const WORKTREE_BUDGET_MS = 8_000 as const;

/** changedFiles name cap per tree (spec §5.2 — ≤200 names, then truncated flag). */
export const MAX_WORKTREE_CHANGED_FILES = 200 as const;

/** The window of trunk history the squash detector matches tree-hashes against. */
export const SQUASH_DETECT_SINCE = "150 days ago" as const;
