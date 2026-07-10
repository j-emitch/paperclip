/**
 * The triage contract (COS-8e) — the ONE documented home for every numeric
 * threshold that decides "does this line of work need attention?". Before 8e
 * these lived scattered (BEHIND_WARN/STALE_WARN in git-state.ts,
 * WORKTREE_ACTIVE_DAYS in worktree-board.ts) while the severity map lived in
 * branch-health.ts — four files to read before you could answer "why is this
 * branch flagged?". The full contract is:
 *
 *   1. THRESHOLDS (this file) turn raw git numbers into `BranchStatus` flags /
 *      worktree lane rungs (`computeStatuses` in BranchSource; `laneOfWorktree`
 *      / `cardOfBranch` in deriveWorktreeBoard).
 *   2. `BRANCH_STATUS_SEVERITY` (branch-health.ts) maps each status to a
 *      severity; `isAttentionSeverity` (high|medium) IS "needs attention" —
 *      the one ladder Home, the Branch·PR band, and the tab rail all read.
 *   3. PR-action statuses fold in via `prActionStatuses` (branch-health.ts).
 *   4. Cost caps (MAX_CONFLICT_CHECKS / REPO_GIT_BUDGET_MS in git-state.ts,
 *      WORKTREE_BUDGET_MS in worktree-board.ts) bound what the scan can SEE —
 *      they are budget knobs, not triage thresholds, but they gate coverage
 *      (K7), so the Branch·PR repo header renders conflict-prediction
 *      coverage so a budget-blinded repo can't read as calm.
 *
 * K7 ALERT-NOISE DECISIONS (2026-07-09, two rounds against the LIVE population;
 * round-1 capture: jb = 203 branches / 117 conflict-eligible / 29 active-eligible;
 * round-2 capture, post-round-1 live derive: jb attention lane still 103/208
 * cards — 79 of them "behind-heavy" ACTIVE trees (p50 behind = 68), company 41
 * (p50 = 325 — a docs-velocity trunk), arc 5 (ALL behind 7-24)):
 *   - `stale` and `unmerged_orphan` are LOW severity (cleanup-queue items, not
 *     daily alerts) — an old tip with no fresh work flooding the attention
 *     band was the original K7 signal (165 jb cards).
 *   - `behind` fires ONLY while the branch is still ACTIVE (tip within
 *     STALE_WARN days), and is LOW severity: with conflict prediction at real
 *     coverage (48-cap, dirty+recent-first), behind-alone is informational —
 *     `conflicting`, `dirty`, and the PR-action statuses own the attention
 *     band. Trunk velocity (~28 commits/wk jb; far higher on company) makes any
 *     small behind threshold vacuous, which round 2 proved live.
 *   - The worktree lane ladder promotes behind-heavy to `needs_attention` only
 *     when the tree is ALSO DIRTY (uncommitted work sitting on a diverging
 *     base); a clean active behind tree is routine in-flight work — rebase is
 *     an ordinary step, not an alert. Branch-only cards (no working tree to be
 *     dirty) rely on `conflicts-predicted`.
 *   - Dirty stays MEDIUM everywhere (uncommitted work at risk is real), and
 *     `conflicting` stays the only HIGH.
 */

/**
 * A branch/tree is "behind-heavy" past this many commits behind its trunk —
 * roughly ONE WEEK of this workspace's trunk velocity (round-2 K7: 6 tripped on
 * effectively every active tree within days).
 */
export const BEHIND_WARN = 24 as const;

/** A tip older than this many days is stale — and no longer "active" for the behind rule. */
export const STALE_WARN = 14 as const;

/** A worktree tip within this many days counts as active for the lane ladder. */
export const WORKTREE_ACTIVE_DAYS = 21 as const;
