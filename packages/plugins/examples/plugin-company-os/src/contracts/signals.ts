/**
 * Typed signals — the normalized, source-agnostic currency between the
 * `WorkSignalSource`s and the pure projections.
 *
 * A source's only job is to turn git/gh/fs/AGENTS reality into these shapes;
 * a projection's only job is to fold these shapes into a persisted contract.
 * Neither knows about the other's format. Signals are in-process (they never
 * cross the DB/IPC boundary as-is — the projections do), so they are plain
 * TypeScript: compile-time contracts, no runtime zod cost.
 *
 * Every signal carries the same provenance envelope (spec §5.1):
 *   { source, repo, path?, sha?, prNumber?, mtime?, confidence, freshness, errors[] }
 */

import type {
  ArtifactType,
  ReviewReportKind,
  ReviewVerdict,
  SignalConfidence,
  SignalErrorCode,
  SignalFreshness,
  TeachingAudience,
  TeachingEntryKind,
  TeachingLens,
  TeachingPublishState,
  UnclassifiedReason,
  WorkSignalPrecedence,
  WorkState,
} from "./vocab.js";

/** A non-fatal problem attached to a single signal (sources record, never throw). */
export interface SignalError {
  readonly code: SignalErrorCode;
  readonly message: string;
  /** True when this error means the signal is degraded/last-good rather than fresh. */
  readonly degraded: boolean;
}

/**
 * The provenance every signal shares. Optional fields are present only when the
 * underlying read supplies them (a file signal has `path`+`mtime`; a commit
 * signal has `sha`; a PR signal has `prNumber`).
 */
export interface SignalProvenance {
  /** The `WorkSignalSource.id` that emitted this signal. */
  readonly source: string;
  /** Repo key the signal pertains to (e.g. "juice-bar"). */
  readonly repo: string;
  /** Workspace-relative path, when file-derived. */
  readonly path?: string;
  /** Full commit sha, when commit-derived. */
  readonly sha?: string;
  /** PR number, when PR-derived. */
  readonly prNumber?: number;
  /** Source mtime / commit time as ISO-8601, when known. */
  readonly mtime?: string;
  readonly confidence: SignalConfidence;
  readonly freshness: SignalFreshness;
  /** Non-fatal problems hit producing this signal; empty = clean. */
  readonly errors: readonly SignalError[];
}

// ---------------------------------------------------------------------------
// The four signal kinds (discriminated by `kind`)
// ---------------------------------------------------------------------------

/** Places a ticket into a board column. The board's chips are projected from these. */
export interface WorkSignal extends SignalProvenance {
  readonly kind: "work";
  /** Resolved ticket id `PREFIX-NN`; null when unclassifiable. */
  readonly ticketId: string | null;
  /** Resolved prefix (e.g. "COS"); null when unresolved. */
  readonly prefix: string | null;
  /** The work-state column this signal argues for. */
  readonly state: WorkState;
  /** Which precedence rule resolved `ticketId` (audit trail / diagnostics). */
  readonly precedence: WorkSignalPrecedence;
  /** Raw evidence (branch name / PR title / commit subject) — diagnostics + Unclassified detail. */
  readonly evidence: string;
  /** Optional human title (PR title, spec heading) for the chip. */
  readonly title?: string;
  /** Deep-link URL (PR url, etc.), when available. */
  readonly url?: string;
  /** Set when `ticketId` is null — why this work couldn't be classified. */
  readonly unclassifiedReason?: UnclassifiedReason;
  /**
   * True for a `state: "shipped"` signal that is actually a REVERT of a prior
   * ship (a `Revert "<scoped subject>"` commit). The projection uses this to
   * un-ship the ticket rather than place a shipped chip (spec §6 Shipped
   * extraction: "reverts (un-ship)"). Only meaningful when `state === "shipped"`.
   */
  readonly reverted?: boolean;
}

/**
 * Teaching-corpus metadata a `TeachingSignalSource` (COS-2f) attaches to the
 * `ArtifactSignal`s it emits — the ONE piece of teaching-specific shape allowed
 * on the core signal, deliberately a single optional nested field so a
 * non-teaching artifact (spec / handoff / cannons) never grows a teaching column.
 * `undefined` on every artifact except teaching corpus files; the generic
 * artifact-index projection ignores it, and only `deriveTeachingOverview` reads
 * it. This is what lets teaching flow through the existing `ArtifactSignal` seam
 * (`artifactType: "teaching"`) — as COS-0b intended ("teaching is first-class in
 * the index") — without a parallel signal kind or a schema bump.
 */
export interface TeachingArtifactMeta {
  /** Which teaching artifact this is: an inbox promote-log, a unit, or a synthesis receipt. */
  readonly entryKind: TeachingEntryKind;
  /** Corpus lens derived from the PATH (`internal`/`external`; `unspecified` pre-migration). */
  readonly lens: TeachingLens | null;
  /** Unit frontmatter `audience` (default `internal`); null for inbox/synthesis. */
  readonly audience: TeachingAudience | null;
  /** Unit frontmatter `publish_state` (default `private`); null for inbox/synthesis. */
  readonly publishState: TeachingPublishState | null;
  /** Unit directory name (e.g. `03-migrations-and-staging`); null when not a unit. */
  readonly unit: string | null;
  /** Pending teaching nuggets counted in an inbox promote-log; null for unit/synthesis. */
  readonly pendingNuggets: number | null;
  /** Unit frontmatter `last_verified` (ISO date); null when absent/not a unit. */
  readonly lastVerified: string | null;
}

/** A workspace artifact (spec / handoff / cannons / routine output / teaching / knowledge). */
export interface ArtifactSignal extends SignalProvenance {
  readonly kind: "artifact";
  readonly artifactType: ArtifactType;
  /** Workspace-relative path (also on `path`; duplicated as required for the index row). */
  readonly relPath: string;
  /** L1 system inferred from frontmatter/path; null when unknown. */
  readonly system: string | null;
  /** Prefix inferred from frontmatter/filename; null when unknown. */
  readonly prefix: string | null;
  /** Lifecycle status from frontmatter (e.g. "active", "done"); null when absent. */
  readonly status: string | null;
  /** Content hash for change detection. */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Human title from frontmatter/first-heading; null when absent. */
  readonly title: string | null;
  /**
   * Teaching-corpus metadata — present ONLY on signals a `TeachingSignalSource`
   * emits (`artifactType: "teaching"`), absent on every other artifact. See
   * `TeachingArtifactMeta`.
   */
  readonly teaching?: TeachingArtifactMeta;
}

/** A report-routine contract (from an AGENTS.md fenced block) joined with its last-run, if known. */
export interface RoutineSignal extends SignalProvenance {
  readonly kind: "routine";
  /** Stable routine key from the fenced block (e.g. "daily-standup"). */
  readonly routineKey: string;
  /** Human routine name (e.g. "Daily Standup"). */
  readonly displayName: string;
  /** Owning directive agent (CEO | COO | CTO | Librarian). */
  readonly ownerAgent: string;
  /** Cadence token: "daily" | "weekly" | "hourly" | a cron string. */
  readonly cadence: string;
  /** Workspace glob the routine is expected to write (e.g. "company/reports/standup/*.md"). */
  readonly expectedArtifactGlob: string;
  /** Last-run timestamp (ISO-8601) from issues.read, when known. */
  readonly lastRunAt?: string;
}

/** A prefix→family→system mapping from the canonical registry. */
export interface TaxonomySignal extends SignalProvenance {
  readonly kind: "taxonomy";
  readonly prefix: string;
  readonly family: string;
  readonly l1System: string;
  readonly l2Subsystem: string | null;
  readonly isGeneric: boolean;
}

/**
 * An on-disk review report (cannons / review) parsed from its frontmatter. NOT a
 * board column of its own — the projection JOINS these onto In-review work
 * chips by `{repo, sha (full), prNumber?, reportKind, generatedAt}` to resolve
 * `ChipReviewState`. These reports are gitignored + machine-local, so their
 * ABSENCE is meaningful: no `ReviewSignal` for a PR ⇒ `unknown` (not
 * "unreviewed"). The same report ALSO surfaces in the docs/reports viewer as an
 * `ArtifactSignal` (`artifactType: "cannons"`) — that is `ArtifactSource`'s job,
 * not this signal's, so the two concerns stay decoupled (spec §6 In-review key).
 */
export interface ReviewSignal extends SignalProvenance {
  readonly kind: "review";
  /**
   * Full commit sha the report pertains to — REQUIRED (narrows the optional
   * provenance `sha`). The In-review join keys on it, so a report with no sha is
   * useless to this signal: `ReviewReportSource` reports a `parse_error` and
   * emits nothing rather than a join-less signal.
   */
  readonly sha: string;
  /** Which report store this came from (the `report_kind` half of the join key). */
  readonly reportKind: ReviewReportKind;
  /** Parsed verdict; `unknown` when a report exists but its verdict is unparseable. */
  readonly verdict: ReviewVerdict;
  /** ISO-8601 report generation time (frontmatter `run_at`/`generated_at`) — the join's tiebreak. */
  readonly generatedAt: string;
  /** Issue counts when the report records them (cannons p0/p1/p2). */
  readonly p0?: number;
  readonly p1?: number;
  readonly p2?: number;
  /** Branch the report was generated against (frontmatter), when present. */
  readonly branch?: string;
}

/** The discriminated union of everything a source can emit. */
export type Signal = WorkSignal | ArtifactSignal | RoutineSignal | TaxonomySignal | ReviewSignal;

/** Narrowing helpers — keep the `kind` discriminant the single branch point. */
export const isWorkSignal = (s: Signal): s is WorkSignal => s.kind === "work";
export const isArtifactSignal = (s: Signal): s is ArtifactSignal => s.kind === "artifact";
export const isRoutineSignal = (s: Signal): s is RoutineSignal => s.kind === "routine";
export const isTaxonomySignal = (s: Signal): s is TaxonomySignal => s.kind === "taxonomy";
export const isReviewSignal = (s: Signal): s is ReviewSignal => s.kind === "review";
