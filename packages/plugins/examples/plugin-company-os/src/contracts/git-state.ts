/**
 * `GitStateV1` — the full Source-tab payload (spec §5.3), PROJECT-GROUPED. Folds
 * `RepoGitSignal` + `BranchSignal` into one browsable tree: project family →
 * member repos (primary first, incl. absent 0-rows) → branches.
 *
 * Layering note (why a persisted `BranchGitV1` row, not the `BranchSignal`):
 * the COS-0 import boundary is "the UI imports ONLY projection TYPES, never
 * signals/sources/context" (see `contracts/index.ts`). So this contract carries
 * its OWN persisted branch row — the BranchSignal *git payload* minus the source
 * provenance envelope (source/confidence/freshness/errors) — exactly as
 * `board-state.ts` derives `Chip` from `WorkSignal` rather than embedding it.
 * `deriveGitState` maps `BranchSignal → BranchGitV1` (1d.2). This keeps the
 * persisted jsonb lean and the UI off the signal layer.
 *
 * zod-first with vocab-built enums + drift guards, mirroring `artifact-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import { projectGroupV1Schema, projectTaxonomyV1Schema } from "./projects.js";
import {
  BRANCH_COMPARISONS,
  PR_CI_STATES,
  PR_MERGEABLE_STATES,
  BRANCH_STATUSES,
  HEALTH_SEVERITIES,
  PROJECT_REPO_ROLES,
  REPO_AVAILABILITY,
  REVIEW_REPORT_KINDS,
  REVIEW_VERDICTS,
  type AssertEqual,
  type BranchComparison,
  type BranchStatus,
  type Expect,
  type HealthSeverity,
  type PrCiState,
  type PrMergeableState,
  type RepoAvailability,
  type ReviewReportKind,
  type ReviewVerdict,
} from "./vocab.js";

export const GIT_STATE_SCHEMA_VERSION = 1 as const;

/** §7 branch-health thresholds (default values; the alert math lives in the projection). */
export const BEHIND_WARN = 6 as const;
export const STALE_WARN = 14 as const;
/** Per-repo cost caps for `BranchSource` (spec §5.2/§12). */
export const MAX_CONFLICT_CHECKS = 12 as const;
export const REPO_GIT_BUDGET_MS = 8000 as const;
export const RECENT_COMMITS_PER_BRANCH = 10 as const;

export const repoAvailabilitySchema = z.enum(REPO_AVAILABILITY);
export const branchComparisonSchema = z.enum(BRANCH_COMPARISONS);
/** Shared by `BranchGitV1` here AND `BranchHealthEntryV1` in `orientation.ts`. */
export const branchStatusSchema = z.enum(BRANCH_STATUSES);
/** Review verdict + report store — the `ReviewSignal` half of the Branch·PR join (COS-5e). */
export const reviewVerdictSchema = z.enum(REVIEW_VERDICTS);
export const reviewReportKindSchema = z.enum(REVIEW_REPORT_KINDS);
/**
 * Per-branch git-status severity (COS-5e) — computed ONCE in `deriveGitState` via the
 * shared `branchStatusSeverity`, the same function `deriveOrientation` uses for Home,
 * and PERSISTED so the browser UI reads it as data (the COS-0 import boundary forbids
 * the UI value-importing the severity function). Keeps Home's count ≡ the Branch·PR band.
 */
export const healthSeveritySchema = z.enum(HEALTH_SEVERITIES);

/** Resolved trunk the branch is compared against (mirrors the signal `TrunkRef`). */
export const trunkRefV1Schema = z.object({
  ref: z.string().nullable(),
  state: z.enum(["ok", "missing"]),
});
export type TrunkRefV1 = z.infer<typeof trunkRefV1Schema>;

/** `--shortstat` summary for a commit (mirrors the signal `CommitStat`). */
export const commitStatV1Schema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type CommitStatV1 = z.infer<typeof commitStatV1Schema>;

/** One recent commit on a branch tip (mirrors the signal `CommitRef`). */
export const commitRefV1Schema = z.object({
  sha: z.string().min(1),
  subject: z.string(),
  author: z.string(),
  committedAt: z.string().min(1),
  stat: commitStatV1Schema.optional(),
});
export type CommitRefV1 = z.infer<typeof commitRefV1Schema>;

/**
 * One worktree of a branch — dirty state PER worktree. Carries the worktree dir
 * BASENAME (for display), never the absolute host path: the abs path stays inside
 * `BranchSource` (for `git -C`) and never reaches the persisted contract / the UI
 * (the key-only / no-absolute-path invariant; codex B P1).
 */
export const worktreeGitV1Schema = z.object({
  name: z.string().min(1),
  headSha: z.string().min(1),
  detached: z.boolean(),
  dirtyFileCount: z.number().int().nonnegative().nullable(),
});
export type WorktreeGitV1 = z.infer<typeof worktreeGitV1Schema>;

/**
 * The review joined onto an open PR (COS-5e) — the `ReviewSignal` payload minus its
 * provenance envelope. `current` is the head-freshness of the join: true when the
 * report's commit sha matches the PR's head oid (the review pertains to what's open
 * now), false when only a stale/older report for that PR exists. An ABSENT review is
 * `null` (unknown — never "unreviewed"; reports are gitignored + machine-local).
 */
export const prCiStateSchema = z.enum(PR_CI_STATES);
export const prMergeableStateSchema = z.enum(PR_MERGEABLE_STATES);

export const prReviewV1Schema = z.object({
  verdict: reviewVerdictSchema,
  reportKind: reviewReportKindSchema,
  generatedAt: z.string().min(1),
  /** true ⇒ report sha === PR head sha (head-current); false ⇒ an older report for this PR. */
  current: z.boolean(),
  p0: z.number().int().nonnegative().nullable(),
  p1: z.number().int().nonnegative().nullable(),
  p2: z.number().int().nonnegative().nullable(),
});
export type PrReviewV1 = z.infer<typeof prReviewV1Schema>;

/**
 * An open pull request joined onto its local branch (COS-5e). One row per open PR
 * (a multi-ticket PR fans into multiple `WorkSignal`s in the board projection, but
 * the git-state join dedups them by `prNumber` and merges their `ticketIds`).
 * `headSha` is the PR's head oid — compared against the local branch tip to flag
 * "local N commits ahead of the pushed PR head". `review` is the joined report or
 * null (unknown).
 */
export const branchPrV1Schema = z.object({
  prNumber: z.number().int().positive(),
  title: z.string().nullable(),
  // Identity/link fields are non-empty-or-null (never "" — an empty string must not
  // masquerade as a real ref/sha/url and, e.g., trip the local-vs-PR-head diff; codex P2).
  url: z.string().min(1).nullable(),
  isDraft: z.boolean(),
  /** The PR's head branch ref — the branch-attachment join key; shown for orphan PRs. */
  headRef: z.string().min(1).nullable(),
  /** The PR head commit oid (may differ from the local tip); null when gh omitted it. */
  headSha: z.string().min(1).nullable(),
  updatedAt: z.string().min(1).nullable(),
  /** Tickets this PR resolves (title scope, else head branch) — cross-links to the Atlas. */
  ticketIds: z.array(z.string()),
  review: prReviewV1Schema.nullable(),
  /**
   * CI + mergeability from the COS-11.gh-fields rollup (bounded per-PR
   * `gh pr view --json statusCheckRollup,mergeable`, cache-by-change). Defaults
   * keep pre-slice cached payloads parseable: an old row reads as `unknown`.
   */
  ciState: prCiStateSchema.default("unknown"),
  mergeableState: prMergeableStateSchema.default("unknown"),
});
export type BranchPrV1 = z.infer<typeof branchPrV1Schema>;

/**
 * One rollup-cache entry (COS-11.gh-fields rate contract): re-fetch a PR's
 * rollup ONLY when its `(headSha, updatedAt)` changed. The map is persisted on
 * the payload because `PullRequestSource` is STATELESS — the derive threads the
 * PREVIOUS payload's map back in via `CollectionContext.prior` (codex P0 fold).
 */
export const prRollupCacheEntryV1Schema = z.object({
  repoKey: z.string().min(1),
  prNumber: z.number().int().positive(),
  headSha: z.string().nullable(),
  updatedAt: z.string().nullable(),
  ciState: prCiStateSchema,
  mergeableState: prMergeableStateSchema,
});
export type PrRollupCacheEntryV1 = z.infer<typeof prRollupCacheEntryV1Schema>;

/** Cache-map key: one rollup per (repo, PR). */
export function prRollupKey(repoKey: string, prNumber: number): string {
  return `${repoKey}#${prNumber}`;
}

/** Per-tick bound on rollup fetches — the other half of the rate contract. */
export const MAX_ROLLUP_FETCHES = 20;

/** The persisted per-branch row — the `BranchSignal` git payload (no provenance envelope). */
export const branchGitV1Schema = z.object({
  branch: z.string().nullable(),
  headSha: z.string().min(1),
  worktrees: z.array(worktreeGitV1Schema),
  trunk: trunkRefV1Schema,
  comparison: branchComparisonSchema,
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  conflictsWithTrunk: z.boolean().nullable(),
  lastCommitAt: z.string().min(1).nullable(),
  staleDays: z.number().int().nonnegative(),
  recentCommits: z.array(commitRefV1Schema),
  statuses: z.array(branchStatusSchema),
  /** Worst-of-`statuses` severity (COS-5e) — projection-computed, so the UI needn't recompute it. */
  attentionSeverity: healthSeveritySchema,
  /** Open PRs whose head ref is this branch (COS-5e); [] when none — shown as 0, not hidden. */
  pullRequests: z.array(branchPrV1Schema),
});
export type BranchGitV1 = z.infer<typeof branchGitV1Schema>;

/** One member repo of a project's git section — incl. configured-but-absent 0-rows. */
export const repoGitStateV1Schema = z.object({
  repoKey: z.string().min(1),
  role: z.enum(PROJECT_REPO_ROLES),
  /** Configured-but-absent repos render honestly, never vanish. */
  availability: repoAvailabilitySchema,
  trunk: trunkRefV1Schema,
  /** [] when availability !== "ok". */
  branches: z.array(branchGitV1Schema),
  /**
   * Open PRs for this repo whose head ref matches NO local branch (COS-5e) — a PR
   * from a branch checked out on another machine, or already deleted locally. Kept
   * visible (never dropped) so the branch/PR picture is honest; [] when none.
   */
  orphanPullRequests: z.array(branchPrV1Schema),
});
export type RepoGitStateV1 = z.infer<typeof repoGitStateV1Schema>;

export const projectGitSectionV1Schema = z.object({
  group: projectGroupV1Schema,
  /** Projection-time: set when the config primary is absent-on-disk but a dependency is available (§5.7). */
  displayPrimaryRepoKey: z.string().min(1).optional(),
  /** Member repos (primary first); includes ABSENT repos as 0-rows. */
  repos: z.array(repoGitStateV1Schema),
});
export type ProjectGitSectionV1 = z.infer<typeof projectGitSectionV1Schema>;

export const gitStateV1Schema = z.object({
  schemaVersion: z.literal(GIT_STATE_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  /** Embedded so the UI renders headers without a 2nd fetch (§5.7). */
  taxonomy: projectTaxonomyV1Schema,
  /** One per project family, in taxonomy order. */
  groups: z.array(projectGitSectionV1Schema),
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(diagnosticSchema),
  /**
   * The persisted rollup cache (COS-11.gh-fields) — keyed `prRollupKey(repo, n)`.
   * Defaulted so pre-slice payloads parse; rebuilt from CURRENT open PRs each
   * derive (a closed PR's entry drops out with its signal).
   */
  prRollups: z.record(z.string(), prRollupCacheEntryV1Schema).default({}),
});
export type GitStateV1 = z.infer<typeof gitStateV1Schema>;

/** Parse + validate (throws on malformed). Use on cache read. */
export function parseGitStateV1(input: unknown): GitStateV1 {
  return gitStateV1Schema.parse(input);
}

export function safeParseGitStateV1(input: unknown): z.SafeParseReturnType<unknown, GitStateV1> {
  return gitStateV1Schema.safeParse(input);
}

// Drift guards: the schema enums and the canonical tuples cannot diverge.
type _AvailabilityMatches = Expect<AssertEqual<z.infer<typeof repoAvailabilitySchema>, RepoAvailability>>;
type _ComparisonMatches = Expect<AssertEqual<z.infer<typeof branchComparisonSchema>, BranchComparison>>;
type _BranchStatusMatches = Expect<AssertEqual<z.infer<typeof branchStatusSchema>, BranchStatus>>;
type _ReviewVerdictMatches = Expect<AssertEqual<z.infer<typeof reviewVerdictSchema>, ReviewVerdict>>;
type _ReviewReportKindMatches = Expect<AssertEqual<z.infer<typeof reviewReportKindSchema>, ReviewReportKind>>;
type _HealthSeverityMatches = Expect<AssertEqual<z.infer<typeof healthSeveritySchema>, HealthSeverity>>;
type _PrCiStateMatches = Expect<AssertEqual<z.infer<typeof prCiStateSchema>, PrCiState>>;
type _PrMergeableMatches = Expect<AssertEqual<z.infer<typeof prMergeableStateSchema>, PrMergeableState>>;
