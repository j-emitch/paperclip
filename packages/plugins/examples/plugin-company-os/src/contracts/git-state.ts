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
  BRANCH_STATUSES,
  PROJECT_REPO_ROLES,
  REPO_AVAILABILITY,
  type AssertEqual,
  type BranchComparison,
  type BranchStatus,
  type Expect,
  type RepoAvailability,
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
