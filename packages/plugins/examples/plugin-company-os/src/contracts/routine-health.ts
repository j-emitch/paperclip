/**
 * `RoutineHealthV1` — the routine-SLO projection (spec §7), the join of:
 *   (a) each agent's routine CONTRACT (sidecar primary, legacy AGENTS fallback:
 *       cadence + expected artifact/proposal + owner agent),
 *   (b) artifact PRESENCE/mtime from the artifact index,
 *   (c) LAST-RUN from issues.read,
 * folded into an SLO verdict per routine (fresh / stale / missing / never_ran).
 *
 * zod-first with the vocab-built verdict enum + a drift guard.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import {
  FRESHNESS_KINDS,
  ROUTINE_VERDICTS,
  type AssertEqual,
  type Expect,
  type FreshnessKind,
  type RoutineVerdict,
} from "./vocab.js";

export const ROUTINE_HEALTH_SCHEMA_VERSION = 1 as const;

export const routineVerdictSchema = z.enum(ROUTINE_VERDICTS);
export const nullableRoutineVerdictSchema = z.union([routineVerdictSchema, z.null()]);
export const routineFreshnessKindSchema = z.enum(FRESHNESS_KINDS);

/** One routine's resolved health. */
export const routineHealthEntrySchema = z.object({
  /** Stable routine key from the fenced block (e.g. "daily-standup"). */
  routineKey: z.string().min(1),
  displayName: z.string().min(1),
  /** Owning directive agent (CEO | COO | CTO | Librarian). */
  ownerAgent: z.string().min(1),
  /** Cadence token: "daily" | "weekly" | "hourly" | a cron string. */
  cadence: z.string().min(1),
  /** Freshness model for this routine-like duty. */
  freshnessKind: routineFreshnessKindSchema,
  /** The workspace glob/source the routine should write/read; empty for embedded duties. */
  expectedArtifactGlob: z.string(),
  /** ISO-8601 last-run (from issues.read); null when never observed. */
  lastRunAt: z.string().nullable(),
  /** ISO-8601 next expected run computed from cadence + lastRun; null when uncomputable. */
  nextExpectedAt: z.string().nullable(),
  /** Did a matching artifact exist for the latest expected window? */
  expectedArtifactPresent: z.boolean(),
  /** Newest matching artifact path; null when none. */
  latestArtifactPath: z.string().nullable(),
  /** Newest matching artifact mtime (ISO-8601); null when none. */
  latestArtifactMtime: z.string().nullable(),
  verdict: nullableRoutineVerdictSchema,
  /** Human one-liner explaining the verdict; null when self-evident. */
  detail: z.string().nullable(),
});
export type RoutineHealthEntry = z.infer<typeof routineHealthEntrySchema>;

export const routineHealthV1Schema = z.object({
  schemaVersion: z.literal(ROUTINE_HEALTH_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  routines: z.array(routineHealthEntrySchema),
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(diagnosticSchema),
});
export type RoutineHealthV1 = z.infer<typeof routineHealthV1Schema>;

/** Parse + validate (throws on malformed). Use on cache read. */
export function parseRoutineHealthV1(input: unknown): RoutineHealthV1 {
  return routineHealthV1Schema.parse(input);
}

export function safeParseRoutineHealthV1(
  input: unknown,
): z.SafeParseReturnType<unknown, RoutineHealthV1> {
  return routineHealthV1Schema.safeParse(input);
}

// Drift guard.
type _RoutineVerdictMatches = Expect<AssertEqual<z.infer<typeof routineVerdictSchema>, RoutineVerdict>>;
type _NullableRoutineVerdictMatches = Expect<AssertEqual<z.infer<typeof nullableRoutineVerdictSchema>, RoutineVerdict | null>>;
type _RoutineFreshnessKindMatches = Expect<AssertEqual<z.infer<typeof routineFreshnessKindSchema>, FreshnessKind>>;
