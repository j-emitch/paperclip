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
  SignalConfidence,
  SignalErrorCode,
  SignalFreshness,
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

/** The discriminated union of everything a source can emit. */
export type Signal = WorkSignal | ArtifactSignal | RoutineSignal | TaxonomySignal;

/** Narrowing helpers — keep the `kind` discriminant the single branch point. */
export const isWorkSignal = (s: Signal): s is WorkSignal => s.kind === "work";
export const isArtifactSignal = (s: Signal): s is ArtifactSignal => s.kind === "artifact";
export const isRoutineSignal = (s: Signal): s is RoutineSignal => s.kind === "routine";
export const isTaxonomySignal = (s: Signal): s is TaxonomySignal => s.kind === "taxonomy";
