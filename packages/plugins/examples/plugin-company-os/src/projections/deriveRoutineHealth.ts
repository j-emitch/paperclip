/**
 * `deriveRoutineHealth` — pure join of routine CONTRACTS (`RoutineSignal` from
 * the AGENTS.md `company_os` blocks) against artifact PRESENCE/mtime (the
 * `ArtifactSignal`s) and LAST-RUN (`RoutineSignal.lastRunAt`, set from
 * issues.read upstream), folded into an SLO verdict per routine.
 *
 * Verdict ladder (against the cadence window W):
 *   never_ran — no artifact ever AND no last-run
 *   fresh     — newest activity within W
 *   stale     — newest activity within (W, 2W]
 *   missing   — newest activity older than 2W (overdue), or no artifact in window
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import { isArtifactSignal, isRoutineSignal } from "../contracts/signals.js";
import {
  ROUTINE_HEALTH_SCHEMA_VERSION,
  type RoutineHealthEntry,
  type RoutineHealthV1,
} from "../contracts/routine-health.js";
import type { RoutineVerdict } from "../contracts/vocab.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";
import { cadenceWindowMs, evaluateRoutine } from "./routine-freshness.js";

// The cadence/verdict math now lives in `routine-freshness.ts` (shared with
// `deriveOrientation`, PF-3a). Re-exported so existing importers (the
// routine-health tests) keep working unchanged.
export { cadenceWindowMs } from "./routine-freshness.js";

export function deriveRoutineHealth(bundle: SignalBundle, nowMs: number): RoutineHealthV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const routines = signals.filter(isRoutineSignal);
  const artifacts = signals.filter(isArtifactSignal);

  const entries: RoutineHealthEntry[] = routines
    .map((r) => {
      const { verdict, freshnessKind, latest, lastActivity, present } = evaluateRoutine(r, artifacts, nowMs);
      const windowMs = cadenceWindowMs(r.cadence);
      const hasActivity = lastActivity > -Infinity;

      return {
        routineKey: r.routineKey,
        displayName: r.displayName,
        ownerAgent: r.ownerAgent,
        cadence: r.cadence,
        freshnessKind,
        expectedArtifactGlob: r.expectedArtifactGlob,
        lastRunAt: r.lastRunAt ?? (latest ? latest.mtime ?? null : null),
        nextExpectedAt: hasActivity && windowMs !== null ? isoFrom(lastActivity + windowMs) : null,
        expectedArtifactPresent: present,
        latestArtifactPath: latest?.relPath ?? null,
        latestArtifactMtime: latest?.mtime ?? null,
        verdict,
        detail: detailFor(verdict, r.cadence, freshnessKind),
      } satisfies RoutineHealthEntry;
    })
    .sort((a, b) => a.ownerAgent.localeCompare(b.ownerAgent) || a.routineKey.localeCompare(b.routineKey));

  const sources = aggregateSourceFreshness(bundle);
  return {
    schemaVersion: ROUTINE_HEALTH_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    routines: entries,
    sources,
    diagnostics: diagnosticsFromFreshness(sources),
  };
}

function detailFor(verdict: RoutineVerdict | null, cadence: string, freshnessKind: string): string | null {
  if (freshnessKind === "embedded") return "embedded duty; no standalone SLO";
  if (verdict === null) return null;
  switch (verdict) {
    case "never_ran":
      return "no run or artifact observed yet";
    case "stale":
      return `overdue past its ${cadence} cadence`;
    case "missing":
      return `no artifact within the expected ${cadence} window`;
    default:
      return null;
  }
}
