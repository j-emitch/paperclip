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

// ---------------------------------------------------------------------------
// WorktreeBoardV1 — the T2 projection payload (zod-first, mirrors doc-index)
// ---------------------------------------------------------------------------

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema } from "./diagnostics.js";
import {
  WORKTREE_LANES,
  WORKTREE_MERGE_STATUSES,
  WORKTREE_ORIGINS,
  type AssertEqual,
  type Expect,
  type WorktreeLane,
  type WorktreeMergeStatus,
  type WorktreeOrigin,
} from "./vocab.js";

export const WORKTREE_BOARD_SCHEMA_VERSION = 1 as const;

export const worktreeLaneSchema = z.enum(WORKTREE_LANES);
export const worktreeOriginSchema = z.enum(WORKTREE_ORIGINS);
export const worktreeMergeStatusSchema = z.enum(WORKTREE_MERGE_STATUSES);

/**
 * One board card — a live WORKTREE (hasWorktree) or a worktree-LESS branch
 * (intent ladder minus `_purpose` — spec §5.2 / Fable major 6). `rung` NAMES
 * the intent-ladder rung that decided the lane; `laneSource` records whether
 * the COH-0 Work Record (declared status source) or a git heuristic decided
 * it (spec §8.6 item 3 — auditable, never silently conflated).
 */
export const worktreeCardV1Schema = z.object({
  /** Join key for reads/links (worktree cards); the branch name for branch-only cards. */
  cardKey: z.string().min(1),
  repoKey: z.string().min(1),
  hasWorktree: z.boolean(),
  /** absByKey pseudo-key (worktree cards) — null for branch-only cards. */
  checkoutKey: z.string().nullable(),
  worktreeName: z.string().nullable(),
  branch: z.string().nullable(),
  origin: worktreeOriginSchema,
  lane: worktreeLaneSchema,
  laneSource: z.enum(["work_record", "heuristic"]),
  /** The resolving intent-ladder rung, e.g. "work-record:wip" | "merged:squash" | "dirty" | "tip-recent" | "stale-tip". */
  rung: z.string().min(1),
  headSha: z.string().nullable(),
  dirtyFileCount: z.number().int().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  lastCommitAt: z.string().nullable(),
  changedFiles: z.array(z.string()).nullable(),
  changedFilesTruncated: z.boolean(),
  mergeStatus: worktreeMergeStatusSchema,
  /** Docs (.md) among changedFiles — drives the docs-updated chip → the 8f URL. */
  docChangedCount: z.number().int(),
  // COH artifacts (spec §8.6 item 5) — display-only lifts from the Work Record.
  ticketIds: z.array(z.string()),
  slug: z.string().nullable(),
  checkpointCount: z.number().int(),
  latestCheckpointAt: z.string().nullable(),
  latestWip: z.boolean().nullable(),
  latestPushed: z.boolean().nullable(),
  activeHandoff: z.string().nullable(),
  /** Cleanup affordance for merged_cleanup cards: coh promote vs raw git (item 1). */
  cleanupKind: z.enum(["coh_promote", "raw_git"]).nullable(),
});
export type WorktreeCardV1 = z.infer<typeof worktreeCardV1Schema>;

export const worktreeRepoSectionV1Schema = z.object({
  repoKey: z.string().min(1),
  /** Activity-gate denominator: changedFiles-evaluated worktrees / total worktrees. */
  evaluated: z.number().int(),
  total: z.number().int(),
  /** Dirty trees the diff budget skipped — NEVER silent (spec AC-8c#3). */
  skippedDirty: z.array(z.string()),
  cards: z.array(worktreeCardV1Schema),
});
export type WorktreeRepoSectionV1 = z.infer<typeof worktreeRepoSectionV1Schema>;

export const worktreeBoardV1Schema = z.object({
  schemaVersion: z.literal(WORKTREE_BOARD_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  repos: z.array(worktreeRepoSectionV1Schema),
  diagnostics: z.array(diagnosticSchema),
});
export type WorktreeBoardV1 = z.infer<typeof worktreeBoardV1Schema>;

export function parseWorktreeBoardV1(input: unknown): WorktreeBoardV1 {
  return worktreeBoardV1Schema.parse(input);
}

export function safeParseWorktreeBoardV1(input: unknown): z.SafeParseReturnType<unknown, WorktreeBoardV1> {
  return worktreeBoardV1Schema.safeParse(input);
}

// Drift guards: schema enums and vocab tuples cannot diverge.
type _LaneMatches = Expect<AssertEqual<z.infer<typeof worktreeLaneSchema>, WorktreeLane>>;
type _OriginMatches = Expect<AssertEqual<z.infer<typeof worktreeOriginSchema>, WorktreeOrigin>>;
type _MergeMatches = Expect<AssertEqual<z.infer<typeof worktreeMergeStatusSchema>, WorktreeMergeStatus>>;
