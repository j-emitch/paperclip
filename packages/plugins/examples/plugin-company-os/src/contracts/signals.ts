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
  BranchComparison,
  BranchStatus,
  DocType,
  FreshnessKind,
  OwnerAgent,
  RepoAvailability,
  ReviewReportKind,
  ReviewVerdict,
  SignalConfidence,
  SignalErrorCode,
  SignalFreshness,
  UnclassifiedReason,
  WorkSignalPrecedence,
  WorkState,
} from "./vocab.js";
import type { Diagnostic } from "./diagnostics.js";
// Type-only (erased at compile time) — no runtime dependency, so no cycle even
// though `skills-catalog.ts` carries zod schemas. Mirrors how the doc signal
// borrows `DocType` from the vocab: the origin enum's home is the skills contract.
import type { SkillOrigin } from "./skills-catalog.js";

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
// The signal kinds (discriminated by `kind`) — COS-0 kinds below, COS-1 git/doc
// kinds further down, and the COS-1R agent kind. The `Signal` union + the
// narrowing helpers at the bottom are the single branch point for all of them.
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
  /** Report author/agent from frontmatter `created_by`; null when absent. */
  readonly createdBy: string | null;
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
  /** Freshness model for this routine-like duty. Omitted for legacy artifact routines until sidecars land. */
  readonly freshnessKind?: FreshnessKind;
  /** Source glob/path used when freshnessKind === "proposal". */
  readonly proposalSource?: string;
  /** Routine-specific artifact excludes for same-owner sibling outputs sharing a directory. */
  readonly exclude?: readonly string[];
  /** Last-run timestamp (ISO-8601) from issues.read, when known. */
  readonly lastRunAt?: string;
}

export interface AgentDutySignal {
  readonly id: string;
  readonly surface: string | null;
}

/** Agent identity + coordination facts for the Agents cockpit. */
export interface AgentSignal extends SignalProvenance {
  readonly kind: "agent";
  /** Directory/config slug; identity only. */
  readonly agentKey: string;
  /** Display name and join key for routine ownership. */
  readonly displayName: OwnerAgent;
  /** Paperclip role slug from config; rendered honestly (COO is "pm"). */
  readonly role: string;
  /** Configured model value; live drift is surfaced later as a diagnostic. */
  readonly model: string;
  readonly reportsTo: string | null;
  readonly budgetMonthlyCents: number | null;
  readonly canCreateAgents: boolean;
  readonly maxTurnsPerRun: number | null;
  readonly heartbeatIntervalSec: number | null;
  readonly summary: string | null;
  readonly duties: readonly AgentDutySignal[];
  readonly handsOffTo: readonly string[];
  readonly receivesFrom: readonly string[];
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

// ---------------------------------------------------------------------------
// COS-1 — git/source signals (Branch + RepoGit) and the renderable doc signal
//
// Three additive union members. Per the plan's PF-5 refinement they carry only
// `repo` (the repoKey, via SignalProvenance) — NOT a `projectKey`: project
// grouping is resolved at PROJECTION time via `projectKeyForRepo(taxonomy,
// repoKey)`, so the signals stay taxonomy-free and the sources stay repo-
// oriented (no fixture/source coupling to the taxonomy).
// ---------------------------------------------------------------------------

/** `--shortstat` summary for one commit, parsed from the same `git log` call (spec §5.1). */
export interface CommitStat {
  readonly filesChanged: number;
  readonly insertions: number;
  readonly deletions: number;
}

/** One recent commit on a branch tip (spec §5.1/§6.2). */
export interface CommitRef {
  readonly sha: string; // abbreviated
  readonly subject: string;
  readonly author: string;
  readonly committedAt: string; // ISO-8601
  /** Optional `--shortstat` summary (files/+/−) from the SAME `git log` call (no extra git call). */
  readonly stat?: CommitStat;
}

/** A live worktree of a branch — dirty state is tracked PER worktree (spec §5.1). */
export interface WorktreeRef {
  readonly path: string;
  readonly headSha: string;
  /** Worktree on a detached HEAD (no branch ref). */
  readonly detached: boolean;
  /** `git -C <path> --no-optional-locks status --porcelain` count; null = unknown/degraded. */
  readonly dirtyFileCount: number | null;
}

/** The resolved trunk a branch is compared against (spec §5.1). */
export interface TrunkRef {
  readonly ref: string | null; // e.g. "origin/main"; null when none resolvable
  readonly state: "ok" | "missing";
}

/**
 * Per-branch git state for the Source + Home surfaces (spec §5.1/§5.2). One per
 * local branch, plus one `branch: null` row per detached/orphaned worktree. A
 * branch checked out in multiple worktrees yields ONE signal whose `worktrees[]`
 * lists them all (dirty per worktree, never collapsed).
 */
export interface BranchSignal extends SignalProvenance {
  readonly kind: "branch";
  /** Local ref short name; null for a detached/orphaned worktree row. */
  readonly branch: string | null;
  /** Tip sha — always present (even when `branch` is null). */
  readonly headSha: string;
  /** 0..N live worktrees of this branch — dirty state PER worktree. */
  readonly worktrees: readonly WorktreeRef[];
  readonly trunk: TrunkRef;
  /** Gates the three nullable comparison fields below. */
  readonly comparison: BranchComparison;
  readonly ahead: number | null; // null unless comparison === "ok"
  readonly behind: number | null; // null unless comparison === "ok"
  /** merge-tree prediction; null when not evaluated OR comparison !== "ok". */
  readonly conflictsWithTrunk: boolean | null;
  /** ISO-8601 of the tip; null when unknown (e.g. an orphan worktree whose log read is empty/degraded). */
  readonly lastCommitAt: string | null;
  readonly staleDays: number; // age of the tip in days (0 when lastCommitAt unknown)
  readonly recentCommits: readonly CommitRef[]; // last N tip commits
  readonly statuses: readonly BranchStatus[]; // derived flags (§7)
}

/**
 * Per-configured-repo git header (spec §5.1/§5.2). Emitted ALWAYS — even for a
 * missing/non-git root — so `deriveGitState` can render a configured-but-absent
 * repo honestly (a pure projection can't tell "ok repo, 0 branches" from
 * "missing repo" without it).
 */
export interface RepoGitSignal extends SignalProvenance {
  readonly kind: "repo_git";
  readonly availability: RepoAvailability;
  readonly trunk: TrunkRef;
  readonly diagnostics: readonly Diagnostic[]; // e.g. "git budget exceeded", "trunk missing"
}

/**
 * A renderable doc (spec/plan/handoff/backlog) discovered across the main
 * checkout AND every worktree (spec §5.4). A DISTINCT kind (not an
 * `ArtifactSignal`) so worktree docs can never leak into the Board /
 * routine-health artifact folds, which assume main-checkout semantics.
 *
 * Per the plan PF-8 refinement the read key is `checkoutKey` (an `absByKey`
 * pseudo-key from the shared `buildCheckoutKeyMap`), NOT an absolute path — the
 * worktree's absolute path survives only as `worktreeName` (basename) provenance.
 */
export interface DocSignal extends SignalProvenance {
  readonly kind: "doc";
  readonly docType: DocType;
  /** STABLE id = hash(repoKey + checkoutId + relPath) — the render/fetch key. */
  readonly docId: string;
  /** "main" | `worktree:${hash(worktreePath-relative-to-repoRoot)}` — collision-safe. */
  readonly checkoutId: string;
  /** The `absByKey` key (main repoKey or a worktree pseudo-key) `doc-content` reads against (PF-8). */
  readonly checkoutKey: string;
  /** Worktree dir basename for the provenance badge; null = main checkout (abs path never leaks here). */
  readonly worktreeName: string | null;
  /** CHECKOUT-ROOT-relative path (relative to the worktree root when set, else the repo main root). */
  readonly relPath: string;
  readonly branch: string | null; // the checkout's branch
  readonly title: string | null; // frontmatter title, else first H1 within the scanned head, else null
  readonly status: string | null; // from frontmatter, when present
  readonly mtime: string; // ISO-8601
  readonly sizeBytes: number;
  /** hash(mtime + sizeBytes + head-bytes) — change-detection/dedup; NOT a full-body hash. */
  readonly indexFingerprint: string;
}

/**
 * A discovered Claude/Codex skill (a SKILL.md) — the currency of the Skills
 * catalog (COS-1h). A DISTINCT kind (not an `ArtifactSignal`/`DocSignal`) so
 * skills never leak into the Board/doc folds. Head-only at index time: `name` +
 * `summary` come from the frontmatter head; the full body is fetched on demand by
 * `skill-content`, keyed by `skillId` → `checkoutKey` + `relPath` (a contained
 * read, mirroring `DocSignal`). The read key is `checkoutKey` (an `absByKey` key —
 * the `company` repo key for workspace skills, or a plugin-root key for installed
 * plugins), NEVER an absolute host path.
 */
export interface SkillSignal extends SignalProvenance {
  readonly kind: "skill";
  /** STABLE id = makeSkillId(checkoutKey, relPath) — the render/fetch key. */
  readonly skillId: string;
  /** "company" (workspace skills) | "plugins" (installed marketplace skills). */
  readonly origin: SkillOrigin;
  /** Sub-grouping within the origin: "design"/"core" for company, a plugin slug for plugins. */
  readonly collection: string;
  /** The `absByKey` key `skill-content` reads the body against (repo key or plugin-root key). */
  readonly checkoutKey: string;
  /** Root-relative path to the SKILL.md. */
  readonly relPath: string;
  /** The skill's directory basename — its slug within a collection. */
  readonly slug: string;
  /** Frontmatter `name`, else the slug. */
  readonly name: string;
  /** Frontmatter `description` — the list summary; null when absent. */
  readonly summary: string | null;
  readonly mtime: string; // ISO-8601
  readonly sizeBytes: number;
  /** hash(mtime + sizeBytes + head-bytes) — change-detection/dedup; NOT a full-body hash. */
  readonly indexFingerprint: string;
}

/** The discriminated union of everything a source can emit. */
export type Signal =
  | WorkSignal
  | ArtifactSignal
  | RoutineSignal
  | TaxonomySignal
  | ReviewSignal
  | AgentSignal
  | BranchSignal
  | RepoGitSignal
  | DocSignal
  | SkillSignal;

/** Narrowing helpers — keep the `kind` discriminant the single branch point. */
export const isWorkSignal = (s: Signal): s is WorkSignal => s.kind === "work";
export const isArtifactSignal = (s: Signal): s is ArtifactSignal => s.kind === "artifact";
export const isRoutineSignal = (s: Signal): s is RoutineSignal => s.kind === "routine";
export const isTaxonomySignal = (s: Signal): s is TaxonomySignal => s.kind === "taxonomy";
export const isReviewSignal = (s: Signal): s is ReviewSignal => s.kind === "review";
export const isAgentSignal = (s: Signal): s is AgentSignal => s.kind === "agent";
export const isBranchSignal = (s: Signal): s is BranchSignal => s.kind === "branch";
export const isRepoGitSignal = (s: Signal): s is RepoGitSignal => s.kind === "repo_git";
export const isDocSignal = (s: Signal): s is DocSignal => s.kind === "doc";
export const isSkillSignal = (s: Signal): s is SkillSignal => s.kind === "skill";
