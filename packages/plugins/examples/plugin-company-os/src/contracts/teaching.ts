/**
 * `TeachingOverviewV1` — the Teaching tab's payload (COS-2f, spec §5 A5 / §9).
 *
 * Unlike the three cached projections (board / artifact-index / routine-health),
 * this is read LIVE per request — the same pattern as `report-content` — so the
 * Teaching loop can be surfaced with NO new DB table / migration (`cos_teaching_*`
 * is deferred to COS-3). The worker's `teaching-overview` handler runs the
 * `TeachingSignalSource` and folds its `ArtifactSignal`s through
 * `deriveTeachingOverview` into this shape on demand.
 *
 * It answers the one question COS-2 exists to make un-ignorable: *is the teaching
 * loop actually running, or is a backlog piling up behind a synthesis that
 * silently stopped?* — via `backlog` (pending logs + nuggets + oldest age),
 * `synthesis` (last-run freshness verdict), and the derived `attention` headline.
 * The unit corpus is faceted by `audience` / `publish_state` / `lens`.
 *
 * zod-first with vocab-built enums + drift guards, mirroring `routine-health.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import { routineVerdictSchema } from "./routine-health.js";
import {
  TEACHING_ATTENTION_LEVELS,
  TEACHING_AUDIENCES,
  TEACHING_LENSES,
  TEACHING_PUBLISH_STATES,
  type AssertEqual,
  type Expect,
  type RoutineVerdict,
  type TeachingAttentionLevel,
  type TeachingAudience,
  type TeachingLens,
  type TeachingPublishState,
} from "./vocab.js";

export const TEACHING_OVERVIEW_SCHEMA_VERSION = 1 as const;

export const teachingAudienceSchema = z.enum(TEACHING_AUDIENCES);
export const teachingPublishStateSchema = z.enum(TEACHING_PUBLISH_STATES);
export const teachingLensSchema = z.enum(TEACHING_LENSES);
export const teachingAttentionLevelSchema = z.enum(TEACHING_ATTENTION_LEVELS);

/** One teaching unit as the tab lists it — the corpus row. */
export const teachingUnitEntrySchema = z.object({
  /** Repo the unit lives in (always `company` in practice; kept for provenance). */
  repo: z.string().min(1),
  /** Workspace-relative path (containment-checked; never absolute). */
  relPath: z.string().min(1),
  /** Frontmatter title, or the file basename when absent. */
  title: z.string().min(1),
  /** Unit directory (e.g. `03-migrations-and-staging`); null when loose. */
  unit: z.string().nullable(),
  /** Corpus lens derived from the path. */
  lens: teachingLensSchema,
  /** Frontmatter `audience` (defaulted to `internal`). */
  audience: teachingAudienceSchema,
  /** Frontmatter `publish_state` (defaulted to `private`). */
  publishState: teachingPublishStateSchema,
  /** Frontmatter `last_verified` (ISO date); null when absent. */
  lastVerifiedAt: z.string().nullable(),
  /** File mtime (ISO-8601); null when unknown. */
  mtime: z.string().nullable(),
});
export type TeachingUnitEntry = z.infer<typeof teachingUnitEntrySchema>;

/** The un-synthesized inbox backlog — the pile COS-2's loop is meant to drain. */
export const teachingBacklogSchema = z.object({
  /** Number of inbox promote-logs still awaiting synthesis. */
  pendingLogs: z.number().int().nonnegative(),
  /** Total teaching nuggets across those logs (bullet count). */
  pendingNuggets: z.number().int().nonnegative(),
  /** mtime of the OLDEST pending log (ISO-8601); null when the backlog is empty. */
  oldestPendingAt: z.string().nullable(),
  /** Age of that oldest log in hours; null when the backlog is empty. */
  oldestPendingAgeHours: z.number().nonnegative().nullable(),
});
export type TeachingBacklog = z.infer<typeof teachingBacklogSchema>;

/** The last synthesis run's freshness — did the loop actually fire recently? */
export const teachingSynthesisSchema = z.object({
  /** mtime of the newest `librarian.teachings-synthesis.json` receipt; null when never. */
  lastSynthesisAt: z.string().nullable(),
  /** Age of that receipt in hours; null when never synthesized. */
  ageHours: z.number().nonnegative().nullable(),
  /** SLO verdict (reuses the routine-health ladder: fresh / stale / missing / never_ran). */
  verdict: routineVerdictSchema,
});
export type TeachingSynthesis = z.infer<typeof teachingSynthesisSchema>;

/** The headline COS-2 exists to surface: is the loop healthy, nudging, or broken? */
export const teachingAttentionSchema = z.object({
  level: teachingAttentionLevelSchema,
  /** Human one-liner explaining the level; null when `ok`. */
  reason: z.string().nullable(),
});
export type TeachingAttention = z.infer<typeof teachingAttentionSchema>;

/** Full-corpus tallies for the facet filters (always every key present — drift-safe). */
export const teachingUnitCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  audience: z.object({
    internal: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    both: z.number().int().nonnegative(),
  }),
  publishState: z.object({
    private: z.number().int().nonnegative(),
    candidate: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
  }),
  lens: z.object({
    internal: z.number().int().nonnegative(),
    external: z.number().int().nonnegative(),
    unspecified: z.number().int().nonnegative(),
  }),
});
export type TeachingUnitCounts = z.infer<typeof teachingUnitCountsSchema>;

export const teachingOverviewV1Schema = z.object({
  schemaVersion: z.literal(TEACHING_OVERVIEW_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  backlog: teachingBacklogSchema,
  synthesis: teachingSynthesisSchema,
  attention: teachingAttentionSchema,
  units: z.array(teachingUnitEntrySchema),
  unitCounts: teachingUnitCountsSchema,
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(diagnosticSchema),
});
export type TeachingOverviewV1 = z.infer<typeof teachingOverviewV1Schema>;

/** Parse + validate (throws on malformed). Use before returning from the worker handler. */
export function parseTeachingOverviewV1(input: unknown): TeachingOverviewV1 {
  return teachingOverviewV1Schema.parse(input);
}

export function safeParseTeachingOverviewV1(
  input: unknown,
): z.SafeParseReturnType<unknown, TeachingOverviewV1> {
  return teachingOverviewV1Schema.safeParse(input);
}

// Drift guards: the schema enums and the canonical tuples cannot diverge.
type _AudienceMatches = Expect<AssertEqual<z.infer<typeof teachingAudienceSchema>, TeachingAudience>>;
type _PublishMatches = Expect<AssertEqual<z.infer<typeof teachingPublishStateSchema>, TeachingPublishState>>;
type _LensMatches = Expect<AssertEqual<z.infer<typeof teachingLensSchema>, TeachingLens>>;
type _AttentionMatches = Expect<AssertEqual<z.infer<typeof teachingAttentionLevelSchema>, TeachingAttentionLevel>>;
type _VerdictMatches = Expect<AssertEqual<z.infer<typeof teachingSynthesisSchema>["verdict"], RoutineVerdict>>;

// The facet-count object keys must stay in lockstep with the vocab tuples — if a
// new audience/publish-state/lens is added, these fail to compile until the
// count schema grows the key too (so the derive can never silently drop a facet).
type _AudienceKeys = Expect<AssertEqual<keyof TeachingUnitCounts["audience"], TeachingAudience>>;
type _PublishKeys = Expect<AssertEqual<keyof TeachingUnitCounts["publishState"], TeachingPublishState>>;
type _LensKeys = Expect<AssertEqual<keyof TeachingUnitCounts["lens"], TeachingLens>>;
