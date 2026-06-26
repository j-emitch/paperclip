/**
 * Closed vocabularies — the single source of truth for every enum the cockpit
 * uses across the whole pipeline (signals → projections → DB cache → UI).
 *
 * Each vocabulary is declared ONCE here as an `as const` tuple; the derived
 * union type is exported alongside it, and the projection schemas in
 * `board-state.ts` / `artifact-index.ts` / `routine-health.ts` build their zod
 * enums *from these same tuples* (`z.enum(WORK_STATES)` etc.). That makes
 * vocabulary drift impossible: add a value here and every consumer — type,
 * schema, and the compile-time guards below — moves in lockstep.
 *
 * This file is deliberately zod-free. It is the lowest layer of the contracts
 * module (no imports), so signals, the source seam, and the projections can all
 * depend on it without any cycle. zod enters one layer up, where it is built
 * from these tuples.
 */

// ---------------------------------------------------------------------------
// Signal-envelope vocabularies
// ---------------------------------------------------------------------------

/** Confidence a source has in a single signal's classification. Drives precedence + diagnostics. */
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type SignalConfidence = (typeof CONFIDENCE_LEVELS)[number];

/** How fresh the underlying read is. Drives the board's per-source stale badge. */
export const FRESHNESS_LEVELS = ["live", "cached", "stale"] as const;
export type SignalFreshness = (typeof FRESHNESS_LEVELS)[number];

/** Non-fatal problems a source records on a signal (never thrown — see §5.1/§6). */
export const SIGNAL_ERROR_CODES = [
  "repo_unavailable", // configured repo root missing or not a git repo at derive time
  "subprocess_failed", // git/gh exited non-zero
  "subprocess_timeout", // git/gh killed by the hard timeout
  "gh_unauthenticated", // gh has no auth (degrade to stale, never throw)
  "gh_rate_limited", // gh hit the API rate limit
  "parse_error", // a file/JSON/frontmatter blob could not be parsed
  "containment_violation", // a path escaped the workspace root (traversal/symlink)
  "oversize", // a file exceeded the docs-viewer size cap
  "not_found", // an expected file/ref was absent
] as const;
export type SignalErrorCode = (typeof SIGNAL_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Board vocabularies
// ---------------------------------------------------------------------------

/**
 * Work-states a ticket can occupy. These ARE the board columns (1:1) — `ColumnId`
 * in `board-state.ts` is a re-export of `WorkState`, so a single tuple defines
 * both the signal's `state` and the board's columns. Order is the column order.
 */
export const WORK_STATES = ["next_up", "in_progress", "in_review", "shipped"] as const;
export type WorkState = (typeof WORK_STATES)[number];

/**
 * The precedence rule that resolved a work signal's ticket id — an audit trail
 * for "why is this chip here" (spec §6 In-progress precedence ladder).
 * `none` = unresolved → the signal lands in the Unclassified lane.
 */
export const WORK_SIGNAL_PRECEDENCE = [
  "branch_path", // (1) explicit PREFIX-NN in the branch path — strongest
  "pr_scope", // (2) PR title/body scope
  "commit_scope", // (3) latest commit subject scope `(PREFIX-NN)`
  "spec_frontmatter", // (4) spec frontmatter cross-ref
  "worktree_meta", // (5) _purpose / INDEX worktree metadata — last resort (stale)
  "none", // unresolved → Unclassified
] as const;
export type WorkSignalPrecedence = (typeof WORK_SIGNAL_PRECEDENCE)[number];

/** Why a chip could not be placed — each Unclassified chip carries exactly one (spec §6). */
export const UNCLASSIFIED_REASONS = [
  "unknown_prefix", // prefix not in the registry
  "generic_prefix", // prefix is registered but flagged is_generic (anti-pattern)
  "bad_branch_format", // branch name yielded no parseable ticket id
  "missing_registry_entry", // ticket id parsed but its prefix has no registry row
  "ambiguous_family", // prefix maps to more than one family (registry conflict)
  "missing_home_system", // family has no home l1 system in the registry
] as const;
export type UnclassifiedReason = (typeof UNCLASSIFIED_REASONS)[number];

/** Review state of an In-review chip. `unknown` = no local report on this machine (NOT "unreviewed"). */
export const CHIP_REVIEW_STATES = ["reviewed", "unknown", "none"] as const;
export type ChipReviewState = (typeof CHIP_REVIEW_STATES)[number];

/**
 * Which on-disk review-report family a `ReviewSignal` came from — the cockpit's
 * two gitignored report stores (`reports/review-cannons/**` and
 * `reports/reviews/**`). Part of the In-review join key `{repo, full_sha,
 * pr_number?, report_kind, generated_at}` (spec §6).
 */
export const REVIEW_REPORT_KINDS = ["cannons", "review"] as const;
export type ReviewReportKind = (typeof REVIEW_REPORT_KINDS)[number];

/**
 * Parsed verdict from a review report's frontmatter. `unknown` = a report exists
 * but its verdict could not be parsed (NOT "no report" — that is the absence of
 * any `ReviewSignal`, which the projection renders as `ChipReviewState.unknown`).
 */
export const REVIEW_VERDICTS = ["ship", "proceed", "revise", "block", "unknown"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

// ---------------------------------------------------------------------------
// Artifact + routine vocabularies
// ---------------------------------------------------------------------------

/** Artifact kinds the index tracks. COS-1 teaching + COS-2 knowledge are first-class here, not bolt-ons. */
export const ARTIFACT_TYPES = [
  "spec",
  "handoff",
  "cannons",
  "routine_output",
  "teaching", // COS-1 — declared now so the index never needs a schema bump
  "knowledge", // COS-2 — same
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** SLO verdict for a report-routine (contract ⋈ artifact mtime ⋈ last-run). */
export const ROUTINE_VERDICTS = ["fresh", "stale", "missing", "never_ran"] as const;
export type RoutineVerdict = (typeof ROUTINE_VERDICTS)[number];

/**
 * Outcome of a docs-viewer `report-content` read (spec §7 safety states). `ok` is
 * the only status that carries `content`; every other is a typed refusal the UI
 * renders as an explicit, non-crashing panel (never a blank). The browser only
 * ever sees workspace-relative paths + these statuses — never an absolute host
 * path or a raw read error.
 */
export const REPORT_CONTENT_STATUSES = [
  "ok", // rendered content present
  "not_indexed", // the (repo, relPath) is not in the vetted artifact index — refuse to read arbitrary files
  "unsupported_type", // extension not on the docs-viewer allowlist (link-only, not rendered)
  "too_large", // exceeds the docs-viewer size cap — "open in your editor"
  "not_found", // file absent / repo not configured / vanished mid-read
  "denied", // containment violation (traversal / symlink escape) — should never reach a user, but typed
] as const;
export type ReportContentStatus = (typeof REPORT_CONTENT_STATUSES)[number];

/** How the docs viewer should render an `ok` payload (drives the markdown-vs-plaintext slot). */
export const REPORT_RENDER_MODES = ["markdown", "text", "none"] as const;
export type ReportRenderMode = (typeof REPORT_RENDER_MODES)[number];

/** The four directive agents that own report-routines (data-driven from AGENTS.md, seeded here). */
export const OWNER_AGENTS = ["CEO", "COO", "CTO", "Librarian"] as const;
export type OwnerAgent = (typeof OWNER_AGENTS)[number];

/** Diagnostic severity, shared by every projection's `diagnostics[]`. */
export const DIAGNOSTIC_LEVELS = ["info", "warn", "error"] as const;
export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];

/** What kicked off a collection run (mirrors the `cos_collection_runs.trigger` column). */
export const COLLECTION_TRIGGERS = ["schedule", "hook", "manual"] as const;
export type CollectionTrigger = (typeof COLLECTION_TRIGGERS)[number];

// ---------------------------------------------------------------------------
// COS-1 — Daily-Driver Cockpit: git/source + docs + project-taxonomy vocabularies
//
// Same single-source rule as above: each is an `as const` tuple here, every zod
// enum in `orientation.ts` / `git-state.ts` / `doc-index.ts` / `projects.ts` is
// built FROM these tuples, and a `Expect<AssertEqual<…>>` guard in each contract
// proves the inferred union still matches — so a new branch-status or doc-type
// can never drift between the type, the schema, and the runtime list.
// ---------------------------------------------------------------------------

/** Whether a configured repo root is a usable git repo at collection time (spec §5.2/§5.7). */
export const REPO_AVAILABILITY = ["ok", "missing", "non_git"] as const;
export type RepoAvailability = (typeof REPO_AVAILABILITY)[number];

/**
 * Whether ahead/behind/conflict could be computed for a branch vs its trunk
 * (spec §5.1). `ok` is the only state that carries non-null ahead/behind; the
 * other three gate those fields to `null`, so a missing trunk or an unrelated
 * history is never rendered as a false "in sync".
 */
export const BRANCH_COMPARISONS = ["ok", "no_merge_base", "missing_trunk", "error"] as const;
export type BranchComparison = (typeof BRANCH_COMPARISONS)[number];

/**
 * Derived branch-health flags (spec §7). A branch can carry several. Severity is
 * assigned at projection time (§7 table). `ahead_clean` is informational, not an
 * alert; `comparison_unavailable` / `conflict_not_evaluated` are neutral states —
 * never a false "clean".
 */
export const BRANCH_STATUSES = [
  "conflicting",
  "behind",
  "stale",
  "dirty",
  "unmerged_orphan",
  "orphaned_worktree",
  "comparison_unavailable",
  "conflict_not_evaluated",
  "ahead_clean",
] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** Severity grade for a branch-health entry (spec §7 — full grade incl. info/low). */
export const HEALTH_SEVERITIES = ["high", "medium", "low", "info"] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

/** The severity an orientation alert can carry — alerts are only high/medium (spec §5.3/§7). */
export const ALERT_SEVERITIES = ["high", "medium"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Orientation alert kinds — the unified "needs attention" union (spec §5.3). */
export const ORIENTATION_ALERT_KINDS = [
  "routine_stale",
  "routine_missing",
  "branch_at_risk",
  "work_stale",
] as const;
export type OrientationAlertKind = (typeof ORIENTATION_ALERT_KINDS)[number];

/** Kinds of recent-work item on the Home cross-session glance (spec §5.3). */
export const RECENT_WORK_KINDS = ["spec", "plan", "pr", "ticket"] as const;
export type RecentWorkKind = (typeof RECENT_WORK_KINDS)[number];

/** The typed deep-link target tabs (no string-URL guessing — spec §5.3). */
export const DEEP_LINK_TABS = ["source", "docs", "board"] as const;
export type DeepLinkTab = (typeof DEEP_LINK_TABS)[number];

/** The doc kinds `DocsSource` emits (spec §5.4). The doc INDEX widens this with `"review"`. */
export const DOC_TYPES = ["spec", "plan", "handoff", "backlog"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * The doc-index type buckets = `DocType ∪ "review"` (review reports are
 * main-checkout-only, sourced from the existing `artifactSource` — spec §5.4).
 * Spelled out (not a spread) so the literal tuple type is preserved for the
 * drift guard in `doc-index.ts`.
 */
export const DOC_INDEX_TYPES = ["spec", "plan", "handoff", "backlog", "review"] as const;
export type DocIndexType = (typeof DOC_INDEX_TYPES)[number];

/** A doc's checkout provenance for the Docs tree badge (spec §5.4/§6.3). */
export const DOC_PROVENANCES = ["main", "worktree"] as const;
export type DocProvenance = (typeof DOC_PROVENANCES)[number];

/** Project-family kind for the taxonomy grouping layer (spec §5.7). */
export const PROJECT_KINDS = ["company", "product", "side_project", "platform"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/** A repo's role within its project family (spec §5.7). */
export const PROJECT_REPO_ROLES = ["primary", "dependency"] as const;
export type ProjectRepoRole = (typeof PROJECT_REPO_ROLES)[number];

/** Provenance of a resolved taxonomy — drives the UI's "configured vs derived" hint (spec §5.7). */
export const TAXONOMY_SOURCES = ["configured", "derived-default", "merged"] as const;
export type TaxonomySource = (typeof TAXONOMY_SOURCES)[number];

// ---------------------------------------------------------------------------
// Compile-time guards — make vocabulary drift a type error, not a runtime bug
// ---------------------------------------------------------------------------

/**
 * `AssertEqual<A, B>` resolves to `true` only when A and B are identical types.
 * Used by the projection files to prove their zod-inferred unions still match
 * these canonical tuples (e.g. `ColumnId === WorkState`). A drift turns the
 * `Expect<...>` line into a compile error rather than a silent divergence.
 */
export type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Forces its argument to be exactly `true` — pair with `AssertEqual` in a type alias. */
export type Expect<T extends true> = T;
