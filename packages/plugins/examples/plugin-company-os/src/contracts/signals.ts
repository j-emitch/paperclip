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
  LaneGroupKind,
  LineageEdgeKind,
  OwnerAgent,
  RepoAvailability,
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
  WorktreeOrigin,
  WorktreeMergeStatus,
  PrCiState,
  PrLandedVia,
  PrMergeableState,
  PrReviewDecision,
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
  /**
   * The PR's head branch name (`gh pr list --json headRefName`) — PR sources only.
   * The Branch·PR Health projection joins an open PR onto its local branch by this
   * ref (a name join survives local commits landing ahead of the pushed PR head, a
   * sha join would not). Absent on non-PR work signals.
   */
  readonly headRef?: string;
  /** True when the PR is a draft (`gh pr list --json isDraft`) — PR sources only. */
  readonly isDraft?: boolean;
  /**
   * CI state folded from the PR's `statusCheckRollup` (COS-11.gh-fields pre-slice)
   * -- PR sources only. `unknown` when the rollup was never fetched this derive
   * AND no cached value existed; the git-state projection persists fetched values
   * in `GitStateV1.prRollups` so unchanged PRs never re-fetch.
   */
  readonly ciState?: PrCiState;
  /** PR mergeability (`gh pr view --json mergeable`) -- PR sources only. */
  readonly prMergeable?: PrMergeableState;
  /** PR review decision (`gh pr list --json reviewDecision`, COS-8a) -- PR sources only. */
  readonly prReviewDecision?: PrReviewDecision;
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
  /** Report author/agent from frontmatter `created_by`; null when absent. */
  readonly createdBy: string | null;
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
  /**
   * Continuously-shipping program → its Atlas built bar reads "· live" rather
   * than a fixed % (COS-5g). Sourced from the registry (`is_rolling`) — the
   * durable home for the flag hardcoded in `deriveBuildAtlas` through 5a/5b/5c.
   */
  readonly isRolling: boolean;
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
 * One COH-0 Work Record checkpoint, parsed from `_purpose` frontmatter's
 * append-only `checkpoints:` list (COS-8c / spec §8.6). Only the lane-relevant
 * fields are lifted; `consumable_artifacts` stays in the file.
 */
export interface WorktreeCheckpoint {
  readonly headSha: string | null;
  readonly wip: boolean | null;
  readonly pushed: boolean | null;
  readonly at: string | null;
}

/**
 * The parsed `_purpose` metadata of a worktree (COH-0 Work Record). `null`
 * fields = key absent. `checkpoints` are ALL parsed entries (newest resolvable
 * via `at`); the LATEST checkpoint's wip/pushed is the declared status source
 * for lane semantics (spec §8.6 item 3).
 */
export interface WorktreePurpose {
  readonly ticketIds: readonly string[];
  readonly slug: string | null;
  readonly phase: string | null;
  readonly lifespan: string | null;
  readonly startedAt: string | null;
  readonly activeHandoff: string | null;
  readonly integrationTarget: string | null;
  readonly checkpoints: readonly WorktreeCheckpoint[];
}

/**
 * Per-worktree lifecycle state for the Branch·PR Worktrees lens (COS-8c /
 * spec §5.2). JOIN KEY = `checkoutKey` (the absByKey pseudo-key — same key the
 * doc index + read handlers use); the worktree's identity in UI is
 * `worktreeName` (basename ONLY — the abs path never leaks). One signal per
 * non-primary worktree of each configured repo.
 */
export interface WorktreeSignal extends SignalProvenance {
  readonly kind: "worktree";
  readonly checkoutKey: string;
  readonly checkoutId: string;
  /** Worktree dir basename (never an abs path). */
  readonly worktreeName: string;
  readonly branch: string | null;
  readonly origin: WorktreeOrigin;
  readonly headSha: string | null;
  /** `--no-optional-locks status --porcelain` count; null = read degraded. */
  readonly dirtyFileCount: number | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly lastCommitAt: string | null;
  /**
   * Names changed vs the trunk merge-base (working-tree-inclusive), capped at
   * `MAX_WORKTREE_CHANGED_FILES`; null = NOT evaluated (activity gate or the
   * per-repo diff budget skipped this tree — see `worktree_diff_capped`).
   */
  readonly changedFiles: readonly string[] | null;
  readonly changedFilesTruncated: boolean;
  /** Parsed `_purpose` Work Record; null = no `_purpose` file for this tree. */
  readonly purpose: WorktreePurpose | null;
  /** COH squash-detector verdict (ported verbatim — see vocab). */
  readonly mergeStatus: WorktreeMergeStatus;
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
  /**
   * Family prefix resolved from the frontmatter `id`/`ticket` or the filename
   * ticket (COS-5). null when no ticket id is derivable (many handoffs/backlog
   * docs). Lets the Build Atlas lifecycle fold attribute a spec/plan to a family
   * without re-reading — the Docs surface ignores it.
   */
  readonly prefix: string | null;
  /**
   * True when this doc's verification frontmatter is set to an approved value —
   * `spec_verified` for a spec, `plan_verified` for a plan (COS-5). Always false
   * for non-spec/plan docTypes. Drives the Atlas Spec/Plan gate `done` state.
   */
  readonly verified: boolean;
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

// ---------------------------------------------------------------------------
// COS-5 — Build Atlas lineage signal
//
// The lineage graph is a single declarative company-repo file (like the prefix
// registry), but unlike per-row taxonomy it is inherently WHOLE — lanes span the
// family set and edges are cross-family — so it is carried as ONE `LineageSignal`
// (the loaded graph), not one-signal-per-edge. `deriveBuildAtlas` folds the
// freshest lineage signal into lane-groups + per-family lineage tags. A distinct
// kind so it is inert to every existing fold (PF-2 filter-in).
// ---------------------------------------------------------------------------

/** A directed lineage relationship between two families. */
export interface LineageEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: LineageEdgeKind;
}

/** A lane within a lineage lane-group — the families assigned to it. */
export interface LineageLane {
  readonly id: string;
  readonly title: string;
  readonly families: readonly string[];
}

/** A lineage lane-group (flow / overlay / second-brain). */
export interface LineageLaneGroup {
  readonly id: string;
  readonly title: string;
  readonly kind: LaneGroupKind;
  readonly lanes: readonly LineageLane[];
}

/** The whole declarative lineage graph, emitted as one signal. */
export interface LineageSignal extends SignalProvenance {
  readonly kind: "lineage";
  readonly laneGroups: readonly LineageLaneGroup[];
  readonly edges: readonly LineageEdge[];
}

// ---------------------------------------------------------------------------
// COS-5 — Paperclip ticket signal (the LYC tracker bridge)
//
// One per exported Paperclip issue (`company/reports/paperclip/tickets/*.md`).
// The worker has no network, so `PaperclipTicketSource` fs-reads the git-tracked
// export and emits these; `deriveBuildAtlas` three-tier-routes them (§5.5):
// `routine_execution` collapses to one Meta·Routines chip per routine key,
// `issue_productivity_review` is dropped, `manual` routes to the family it
// references. A distinct kind so it is inert to every existing fold (PF-2).
// ---------------------------------------------------------------------------

/** A single Paperclip issue (the LYC tracker), read from its exported markdown. */
export interface TicketSignal extends SignalProvenance {
  readonly kind: "ticket";
  /** Ticket identifier, e.g. "LYC-217". */
  readonly identifier: string;
  readonly title: string;
  /** Body text (used for family-reference extraction); "" when absent. */
  readonly description: string;
  readonly status: string | null;
  readonly priority: string | null;
  /** Raw origin: "manual" | "routine_execution" | "issue_productivity_review" | … (never null; source default "manual"). */
  readonly originKind: string;
  /** Parent issue id (a UUID) — the primary routine-collapse key; null when top-level. */
  readonly parentId: string | null;
  /** Assignee agent id (a UUID) — the routine-collapse fallback key half; null when unassigned. */
  readonly assigneeAgentId: string | null;
  /**
   * Family prefixes referenced in `title`+`description` (`extractTicketIds` →
   * `prefixOf`, deduped, order-preserving). The SOURCE derives these mechanically
   * (self-prefix included); the projection applies routing policy (self-exclusion,
   * registry-filter, precedence).
   */
  readonly referencedFamilies: readonly string[];
}

// ---------------------------------------------------------------------------
// COS-8b — recently-landed PR signal
//
// A DISTINCT kind (the PF-2 filter-in idiom — like DocSignal/WorktreeSignal),
// NOT a `WorkSignal` with a marker flag: `deriveBoardState`, `deriveBuildAtlas`,
// and `deriveOrientation` all fold `isWorkSignal` work into board columns /
// Atlas lifecycle / shipped chips, and a merged-PR "shipped" work signal would
// duplicate `GitWorkSource`'s commit-derived ships in every one of them. A
// distinct kind is inert to every existing (and future) work fold by
// construction; only `deriveGitState` consumes it, for the landed lane.
// ---------------------------------------------------------------------------

/** A PR that recently left the open state — the Branch·PR recently-landed lane's currency. */
export interface LandedPrSignal extends SignalProvenance {
  readonly kind: "landed_pr";
  /** PR number — REQUIRED here (narrows the optional provenance `prNumber`). */
  readonly prNumber: number;
  readonly title: string | null;
  readonly url: string | null;
  /** The PR's head branch name; null when gh omitted it. */
  readonly headRef: string | null;
  /** When it landed: `mergedAt`, else `closedAt` (ISO-8601) — the lane's clock. */
  readonly landedAt: string;
  /** merged (GitHub merge) vs closed (ff-push-landed OR abandoned — rendered distinctly). */
  readonly via: PrLandedVia;
  /** Tickets resolved from the PR title scope, else its head branch (may be empty). */
  readonly ticketIds: readonly string[];
}

// ---------------------------------------------------------------------------
// COS-11 — Gates & Pipeline signals (four small read-only sources). Each is a
// DISTINCT kind (PF-2 filter-in): inert to every existing fold; only
// `deriveGatesState` (+ the orientation B17 bridge) consumes them.
// ---------------------------------------------------------------------------

/** Hook-install/parity state for ONE repo (HooksSource — spec §7 row 1/2). */
export interface HooksSignal extends SignalProvenance {
  readonly kind: "hooks";
  /** `git config core.hooksPath` value; null = unset; "unknown" reads failed → see errors. */
  readonly hooksPathValue: string | null;
  /** Byte-diff of the repo's .githooks/* vs the canonical company set. */
  readonly parity: "in_sync" | "drifted" | "missing" | "unknown";
  /** Hook file names that differ/are absent vs canonical ([] unless drifted/missing). */
  readonly driftedHooks: readonly string[];
  /** GATE_SUITES names parsed from the canonical run-hook-tests.sh ([] when unreadable). */
  readonly gateSuites: readonly string[];
  /** Newest row `t` in this repo's guardrails ndjson tail; null = no rows/log (NORMAL). */
  readonly lastGuardrailAt: string | null;
  /** Distinct `hook` kinds seen in the guardrails tail (activity fingerprint). */
  readonly guardrailHookKinds: readonly string[];
  /** Newest cannons-runs line for THIS repo (the pre-push gate's real receipt); null = none. */
  readonly lastGateRun: { readonly runId: string; readonly sha8: string; readonly verdict: string; readonly at: string } | null;
}

/** One drift-audit JSON + apply-receipt summary (MigrationAuditSource — rows 3/4). */
export interface MigrationAuditSignal extends SignalProvenance {
  readonly kind: "migration_audit";
  /** Audit target from the JSON ("staging" | "prod" | whatever it recorded). */
  readonly target: string;
  readonly ranAt: string | null;
  readonly auditRelPath: string;
  readonly auditMtime: string | null;
  readonly totalEntries: number;
  /** Entries whose `applied` !== "yes" — forward drift. */
  readonly notAppliedCount: number;
  readonly orphanTrackerRows: number;
  readonly unauditedBranchFiles: number;
  readonly grantSurfaceViolations: number;
  readonly grantSurfaceScanned: number;
  /** Newest apply receipt (reports/migration-apply/*.md) by mtime; nulls = none found. */
  readonly lastApplyRelPath: string | null;
  readonly lastApplyAt: string | null;
  /** Open [INFRA-DB-CD]-titled issues (the dupe watch — matrix row 11); null = gh unavailable. */
  readonly openDriftIssueCount: number | null;
  /** The rolling issue for THIS target (body marker infra-db-cd-rolling:<target>); null = none/gh unavailable. */
  readonly rollingIssueNumber: number | null;
}

/** One parsed ledger tail (DispatchLedgerSource — row 7; one signal per log). */
export interface DispatchLedgerSignal extends SignalProvenance {
  readonly kind: "dispatch_ledger";
  readonly ledger: "cannons_runs" | "codex_invocations";
  /** True when the tail-window clipped history — renders "history truncated at <ts>". */
  readonly truncated: boolean;
  /** The log's mtime (the watermark shown beside truncation). */
  readonly logMtime: string | null;
  /** Parsed rows, LAST `LEDGER_MAX_ROWS` at most. Exactly one of the two is set. */
  readonly cannonsRuns?: readonly { readonly runId: string; readonly sha8: string; readonly verdict: string; readonly repo: string; readonly at: string; readonly reportPath: string | null }[];
  readonly codexRows?: readonly { readonly t: string; readonly consumer: string; readonly repo: string; readonly success: boolean; readonly model: string }[];
}

/** One managed repo's branch-protection DESIRED state (ProtectionSource — row 5). */
export interface ProtectionSignal extends SignalProvenance {
  readonly kind: "protection";
  /** Short repo name (the manifest key, e.g. "juice-bar"). */
  readonly repoName: string;
  readonly slug: string;
  readonly branch: string;
  readonly enforceAdmins: boolean | null;
  readonly requiredChecks: readonly string[];
  readonly requiredReviews: number | null;
  /**
   * When the live state was last verified against this desired state; null =
   * NEVER verified (no assert receipt exists yet — an honest warn-tier state,
   * not silent-green).
   */
  readonly verifiedAt: string | null;
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
  | WorktreeSignal
  | DocSignal
  | SkillSignal
  | LineageSignal
  | TicketSignal
  | LandedPrSignal
  | HooksSignal
  | MigrationAuditSignal
  | DispatchLedgerSignal
  | ProtectionSignal;

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
export const isLineageSignal = (s: Signal): s is LineageSignal => s.kind === "lineage";
export const isTicketSignal = (s: Signal): s is TicketSignal => s.kind === "ticket";
export const isLandedPrSignal = (s: Signal): s is LandedPrSignal => s.kind === "landed_pr";
export const isHooksSignal = (s: Signal): s is HooksSignal => s.kind === "hooks";
export const isMigrationAuditSignal = (s: Signal): s is MigrationAuditSignal => s.kind === "migration_audit";
export const isDispatchLedgerSignal = (s: Signal): s is DispatchLedgerSignal => s.kind === "dispatch_ledger";
export const isProtectionSignal = (s: Signal): s is ProtectionSignal => s.kind === "protection";
