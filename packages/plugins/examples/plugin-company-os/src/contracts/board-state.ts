/**
 * `BoardStateV1` — the auto-Kanban projection (spec §6), persisted in
 * `cos_board_state.snapshot` and schema-validated on every write AND read.
 *
 * zod-first: each schema is the single definition and the TypeScript type is
 * `z.infer`'d from it, so the validator and the type cannot diverge. Closed
 * enums are built from the canonical tuples in `vocab.ts` (`z.enum(WORK_STATES)`
 * …), and the compile-time guards at the bottom prove the inferred unions still
 * equal those tuples — vocabulary drift is a type error.
 *
 * The UI renders this contract; it NEVER derives. `parseBoardStateV1` is the
 * read/write gate COS-0d calls so a malformed cache row is caught, not rendered.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import {
  CHIP_REVIEW_STATES,
  UNCLASSIFIED_REASONS,
  WORK_SIGNAL_PRECEDENCE,
  WORK_STATES,
  type AssertEqual,
  type ChipReviewState,
  type Expect,
  type UnclassifiedReason,
  type WorkSignalPrecedence,
  type WorkState,
} from "./vocab.js";

/** Bump only on a breaking shape change; the cache row carries it and stale versions re-derive. */
export const BOARD_STATE_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Enums (built from the canonical vocab tuples — single source of truth)
// ---------------------------------------------------------------------------

/** Board columns. Identical to `WorkState` — the columns ARE the work-states (guarded below). */
export const columnIdSchema = z.enum(WORK_STATES);
export type ColumnId = z.infer<typeof columnIdSchema>;

export const unclassifiedReasonSchema = z.enum(UNCLASSIFIED_REASONS);
export const workSignalPrecedenceSchema = z.enum(WORK_SIGNAL_PRECEDENCE);
export const chipReviewStateSchema = z.enum(CHIP_REVIEW_STATES);

// ---------------------------------------------------------------------------
// Board element schemas
// ---------------------------------------------------------------------------

/** A swimlane = one L2 subsystem under an L1 system header (spec §6). */
export const laneSchema = z.object({
  /** Stable lane key, e.g. "JB:Coaching" or "Ops". */
  id: z.string().min(1),
  /** L1 system: JB | ARC | Company. */
  l1System: z.string().min(1),
  /** L2 subsystem: Coaching | Reports | Pipeline | Company-OS | "Unclassified / Ops" … */
  l2Subsystem: z.string().min(1),
  /** Display title for the lane header. */
  title: z.string().min(1),
  /** True for the dedicated Unclassified / Ops lane. */
  isOps: z.boolean(),
  /** Whether the lane renders collapsed by default (e.g. empty or Ops). */
  collapsedByDefault: z.boolean(),
});
export type Lane = z.infer<typeof laneSchema>;

/** A row = one spec-prefix family within its home lane. */
export const prefixRowSchema = z.object({
  prefix: z.string().min(1),
  family: z.string().min(1),
  /** Home lane id this family renders under. */
  laneId: z.string().min(1),
  /** True for the grandfathered generic prefixes (IMPRV/GAP) — rendered with an anti-pattern marker. */
  isGeneric: z.boolean(),
  /** Repos this family appears in (home repo first) — drives the cross-repo badge. */
  repos: z.array(z.string().min(1)),
});
export type PrefixRow = z.infer<typeof prefixRowSchema>;

/** A chip = one `PREFIX-NN` ticket placed in a column. */
export const chipSchema = z.object({
  /** Ticket id `PREFIX-NN`. */
  id: z.string().min(1),
  prefix: z.string().min(1),
  /** Home lane id (cross-repo families render here with a repo badge, not duplicated). */
  laneId: z.string().min(1),
  column: columnIdSchema,
  title: z.string().nullable(),
  /** Primary repo for this chip (the repo badge shows when it differs from the lane's home repo). */
  repo: z.string().min(1),
  /** Why the chip is where it is — the precedence rule that resolved it. */
  precedence: workSignalPrecedenceSchema,
  sha: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  /** Deep-link URL (PR url, etc.); null when none. */
  url: z.string().nullable(),
  /** ISO-8601 of the signal that last moved this chip; null when unknown. */
  updatedAt: z.string().nullable(),
  /** Review state for In-review chips; null for other columns. */
  reviewState: chipReviewStateSchema.nullable(),
});
export type Chip = z.infer<typeof chipSchema>;

/** A chip that could not be placed — lands in the Ops lane with an actionable reason. */
export const unclassifiedChipSchema = z.object({
  /** Synthetic id (branch / worktree / path-derived). */
  id: z.string().min(1),
  repo: z.string().min(1),
  reason: unclassifiedReasonSchema,
  /** Branch name / path / scope that couldn't classify. */
  evidence: z.string(),
  /** The raw prefix if one was extractable but unregistered/generic; null otherwise. */
  prefix: z.string().nullable(),
  /** Actionable nudge ("register COS in prefix-registry.json"); null when none. */
  hint: z.string().nullable(),
});
export type UnclassifiedChip = z.infer<typeof unclassifiedChipSchema>;

// ---------------------------------------------------------------------------
// The persisted contract
// ---------------------------------------------------------------------------

export const boardStateV1Schema = z.object({
  schemaVersion: z.literal(BOARD_STATE_SCHEMA_VERSION),
  /** ISO-8601 derive timestamp. */
  derivedAt: z.string().min(1),
  /** Per-(source, repo) freshness — drives the stale badges. */
  sources: z.array(sourceFreshnessSchema),
  lanes: z.array(laneSchema),
  rows: z.array(prefixRowSchema),
  /** Column order (canonically WORK_STATES); carried so the UI need not import vocab. */
  columns: z.array(columnIdSchema),
  chips: z.array(chipSchema),
  diagnostics: z.array(diagnosticSchema),
  unclassified: z.array(unclassifiedChipSchema),
});
export type BoardStateV1 = z.infer<typeof boardStateV1Schema>;

// ---------------------------------------------------------------------------
// Validation gate (COS-0d calls these on cache write + read)
// ---------------------------------------------------------------------------

/** Parse + validate (throws `ZodError` on a malformed snapshot). Use on cache read. */
export function parseBoardStateV1(input: unknown): BoardStateV1 {
  return boardStateV1Schema.parse(input);
}

/** Non-throwing variant — returns the zod result for callers that handle the bad-row case. */
export function safeParseBoardStateV1(input: unknown): z.SafeParseReturnType<unknown, BoardStateV1> {
  return boardStateV1Schema.safeParse(input);
}

/** The canonical, ordered column list (the UI consumes `BoardStateV1.columns`, not this). */
export const BOARD_COLUMNS: readonly ColumnId[] = WORK_STATES;

// ---------------------------------------------------------------------------
// Compile-time drift guards — these alias lines fail to compile if a vocab
// tuple and its board-facing union ever diverge.
// ---------------------------------------------------------------------------

type _ColumnIdEqualsWorkState = Expect<AssertEqual<ColumnId, WorkState>>;
type _UnclassifiedReasonMatches = Expect<
  AssertEqual<z.infer<typeof unclassifiedReasonSchema>, UnclassifiedReason>
>;
type _PrecedenceMatches = Expect<
  AssertEqual<z.infer<typeof workSignalPrecedenceSchema>, WorkSignalPrecedence>
>;
type _ReviewStateMatches = Expect<
  AssertEqual<z.infer<typeof chipReviewStateSchema>, ChipReviewState>
>;
