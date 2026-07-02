/**
 * `OrientationV1` — the Home (default landing) payload (spec §5.3). A digest of
 * everything the other projections already fold: a pinned routine briefing, a
 * current-snapshot metrics strip, alert-worthy branch health, a recent-commits
 * glance, recent cross-session work, and the unified alerts union — each child
 * (except the company-global briefing) project-tagged so Home groups by family.
 *
 * Home stays SMALL (summary slices + deep-links); the full per-branch detail
 * lives in `GitStateV1` for the Source tab. Both fold the same signals (§5.3) —
 * Home never re-derives, it digests.
 *
 * zod-first with vocab-built enums + drift guards, mirroring `artifact-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import { branchStatusSchema, healthSeveritySchema } from "./git-state.js";
import { projectTaxonomyV1Schema } from "./projects.js";
import {
  ALERT_SEVERITIES,
  DEEP_LINK_TABS,
  FRESHNESS_KINDS,
  ORIENTATION_ALERT_KINDS,
  RECENT_WORK_KINDS,
  ROUTINE_VERDICTS,
  type AlertSeverity,
  type AssertEqual,
  type DeepLinkTab,
  type Expect,
  type FreshnessKind,
  type HealthSeverity,
  type OrientationAlertKind,
  type RecentWorkKind,
  type RoutineVerdict,
} from "./vocab.js";

export const ORIENTATION_SCHEMA_VERSION = 2 as const;

/** Home glance caps (spec §5.3). */
export const HOME_RECENT_COMMITS_LIMIT = 20 as const;
export const HOME_RECENT_WORK_LIMIT = 20 as const;

/**
 * The default pinned briefing set (spec §5.3) — the ORDERED stable role ids. Each
 * resolves to a live routine key via `PINNED_ROLE_TO_ROUTINE` (bound in
 * `deriveOrientation` from routine-contract signals), skipping any role whose
 * routine isn't present. The role ids are the stable contract (used in the §11 AC).
 * COS-1R-f replaced the COS-1 seed with the 1R-a report-cohesion-audit-ratified set
 * + order: daily standup, daily health scan, daily codebase awareness, weekly
 * strategic summary, weekly process enforcement, weekly engineering report.
 */
export const DEFAULT_PINNED_ROLES = [
  "daily-standup",
  "health-scan",
  "codebase-health",
  "strategy",
  "process-audit",
  "weekly-summary",
] as const;

// `healthSeveritySchema` is owned by `git-state.ts` (the foundational branch contract)
// and imported above — orientation shares it rather than defining a second copy (COS-5e).
export const alertSeveritySchema = z.enum(ALERT_SEVERITIES);
export const orientationAlertKindSchema = z.enum(ORIENTATION_ALERT_KINDS);
export const recentWorkKindSchema = z.enum(RECENT_WORK_KINDS);
export const briefingVerdictSchema = z.union([z.enum(ROUTINE_VERDICTS), z.null()]);
export const briefingFreshnessKindSchema = z.enum(FRESHNESS_KINDS);

/** A typed deep-link target — no string-URL guessing (spec §5.3). */
export const deepLinkSchema = z.discriminatedUnion("tab", [
  z.object({ tab: z.literal("source"), repoKey: z.string().min(1), branch: z.string().nullable() }),
  z.object({ tab: z.literal("docs"), docId: z.string().min(1) }),
  z.object({ tab: z.literal("board"), workId: z.string().min(1) }),
]);
export type DeepLink = z.infer<typeof deepLinkSchema>;

/**
 * One pinned briefing card. Company-GLOBAL (the CEO/COO/CTO/Librarian routines
 * are company-level, not per-project) — so NO projectKey.
 */
export const briefingCardV1Schema = z.object({
  routineKey: z.string().min(1),
  displayName: z.string().min(1),
  ownerAgent: z.string().min(1),
  freshnessKind: briefingFreshnessKindSchema,
  verdict: briefingVerdictSchema,
  reportDate: z.string().nullable(),
  repo: z.string().min(1),
  relPath: z.string().nullable(),
});
export type BriefingCardV1 = z.infer<typeof briefingCardV1Schema>;

/** Current-snapshot counts strip (not day-bounded). */
export const metricsStripV1Schema = z.object({
  openPrs: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  alerts: z.number().int().nonnegative(),
  branchesNeedingAttention: z.number().int().nonnegative(),
  dirtyWorktrees: z.number().int().nonnegative(),
});
export type MetricsStripV1 = z.infer<typeof metricsStripV1Schema>;

/** An alert-worthy branch summary for the Home (the full list is in GitStateV1). */
export const branchHealthEntryV1Schema = z.object({
  projectKey: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().nullable(),
  statuses: z.array(branchStatusSchema),
  severity: healthSeveritySchema,
  behind: z.number().int().nonnegative().nullable(),
  staleDays: z.number().int().nonnegative(),
  deepLink: deepLinkSchema,
});
export type BranchHealthEntryV1 = z.infer<typeof branchHealthEntryV1Schema>;

/** A newest-commits-across-all-branches glance entry. */
export const commitGlanceV1Schema = z.object({
  projectKey: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().nullable(),
  sha: z.string().min(1),
  subject: z.string(),
  committedAt: z.string().min(1),
});
export type CommitGlanceV1 = z.infer<typeof commitGlanceV1Schema>;

/** A recent cross-session work item (spec/plan/pr/ticket), deep-linking to the Board/Docs. */
export const recentWorkV1Schema = z.object({
  projectKey: z.string().min(1),
  system: z.string().min(1),
  kind: recentWorkKindSchema,
  title: z.string(),
  status: z.string().nullable(),
  updatedAt: z.string().min(1),
  deepLink: deepLinkSchema,
});
export type RecentWorkV1 = z.infer<typeof recentWorkV1Schema>;

/** One entry in the unified "needs attention" union. */
export const orientationAlertV1Schema = z.object({
  id: z.string().min(1),
  projectKey: z.string().min(1),
  kind: orientationAlertKindSchema,
  severity: alertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  deepLink: deepLinkSchema,
});
export type OrientationAlertV1 = z.infer<typeof orientationAlertV1Schema>;

export const orientationV1Schema = z.object({
  schemaVersion: z.literal(ORIENTATION_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  /** Embedded so Home renders project headers without a 2nd fetch. */
  taxonomy: projectTaxonomyV1Schema,
  briefing: z.array(briefingCardV1Schema),
  metrics: metricsStripV1Schema,
  branchHealth: z.array(branchHealthEntryV1Schema),
  recentCommits: z.array(commitGlanceV1Schema),
  recentWork: z.array(recentWorkV1Schema),
  alerts: z.array(orientationAlertV1Schema),
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(diagnosticSchema),
});
export type OrientationV1 = z.infer<typeof orientationV1Schema>;

/** Parse + validate (throws on malformed). Use on cache read. */
export function parseOrientationV1(input: unknown): OrientationV1 {
  return orientationV1Schema.parse(input);
}

export function safeParseOrientationV1(input: unknown): z.SafeParseReturnType<unknown, OrientationV1> {
  return orientationV1Schema.safeParse(input);
}

// Drift guards: the schema enums and the canonical tuples cannot diverge.
type _SeverityMatches = Expect<AssertEqual<z.infer<typeof healthSeveritySchema>, HealthSeverity>>;
type _AlertSeverityMatches = Expect<AssertEqual<z.infer<typeof alertSeveritySchema>, AlertSeverity>>;
type _AlertKindMatches = Expect<AssertEqual<z.infer<typeof orientationAlertKindSchema>, OrientationAlertKind>>;
type _RecentWorkMatches = Expect<AssertEqual<z.infer<typeof recentWorkKindSchema>, RecentWorkKind>>;
type _VerdictMatches = Expect<AssertEqual<z.infer<typeof briefingVerdictSchema>, RoutineVerdict | null>>;
type _FreshnessKindMatches = Expect<AssertEqual<z.infer<typeof briefingFreshnessKindSchema>, FreshnessKind>>;
type _DeepLinkTabMatches = Expect<AssertEqual<DeepLink["tab"], DeepLinkTab>>;
