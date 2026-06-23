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
import { isArtifactSignal, isRoutineSignal, type ArtifactSignal } from "../contracts/signals.js";
import {
  ROUTINE_HEALTH_SCHEMA_VERSION,
  type RoutineHealthEntry,
  type RoutineHealthV1,
} from "../contracts/routine-health.js";
import type { RoutineVerdict } from "../contracts/vocab.js";
import { matchesAnyGlob } from "../sources/glob.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

const MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };

/** Cadence token → window in ms; null when uncomputable (a cron string). */
export function cadenceWindowMs(cadence: string): number | null {
  const c = cadence.trim().toLowerCase();
  if (c === "hourly") return MS.hour;
  if (c === "daily") return MS.day;
  if (c === "weekly") return MS.week;
  if (c === "monthly") return MS.month;
  return null; // cron / unknown — verdict falls back to presence
}

export function deriveRoutineHealth(bundle: SignalBundle, nowMs: number): RoutineHealthV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const routines = signals.filter(isRoutineSignal);
  const artifacts = signals.filter(isArtifactSignal);

  const entries: RoutineHealthEntry[] = routines
    .map((r) => {
      // Artifacts whose repo-qualified path matches the routine's expected glob.
      // The AGENTS glob is monorepo-parent-relative (`company/reports/...`) while
      // an ArtifactSignal.relPath is repo-relative, so we match against `repo/relPath`.
      const matching = artifacts
        .filter((a) => matchesAnyGlob(`${a.repo}/${a.relPath}`, [r.expectedArtifactGlob]))
        .sort((x, y) => artifactMs(y) - artifactMs(x));
      const latest: ArtifactSignal | undefined = matching[0];

      const lastRunMs = r.lastRunAt ? Date.parse(r.lastRunAt) : NaN;
      const latestMs = latest ? artifactMs(latest) : NaN;
      const hasArtifact = Number.isFinite(latestMs);
      const lastActivity = Math.max(
        Number.isFinite(lastRunMs) ? lastRunMs : -Infinity,
        hasArtifact ? latestMs : -Infinity,
      );
      const hasActivity = lastActivity > -Infinity;

      const windowMs = cadenceWindowMs(r.cadence);
      const verdict = computeVerdict(nowMs, latestMs, hasArtifact, hasActivity, windowMs);
      const present = hasArtifact && (windowMs === null || nowMs - latestMs <= windowMs);

      return {
        routineKey: r.routineKey,
        displayName: r.displayName,
        ownerAgent: r.ownerAgent,
        cadence: r.cadence,
        expectedArtifactGlob: r.expectedArtifactGlob,
        lastRunAt: r.lastRunAt ?? (latest ? latest.mtime ?? null : null),
        nextExpectedAt: hasActivity && windowMs !== null ? isoFrom(lastActivity + windowMs) : null,
        expectedArtifactPresent: present,
        latestArtifactPath: latest?.relPath ?? null,
        latestArtifactMtime: latest?.mtime ?? null,
        verdict,
        detail: detailFor(verdict, r.cadence),
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

function artifactMs(a: ArtifactSignal): number {
  const t = a.mtime ? Date.parse(a.mtime) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Artifact-centric verdict: freshness is about whether the EXPECTED ARTIFACT was
 * produced recently, not merely whether the agent ran. A recent `lastRunAt` with
 * no artifact is `missing` (ran, produced nothing), never `fresh`.
 */
function computeVerdict(
  nowMs: number,
  latestArtifactMs: number,
  hasArtifact: boolean,
  hasActivity: boolean,
  windowMs: number | null,
): RoutineVerdict {
  if (!hasActivity) return "never_ran";
  if (windowMs === null) return hasArtifact ? "fresh" : "stale"; // cron: presence-only
  if (!hasArtifact) return "missing"; // ran (lastRun) but never produced the artifact
  const age = nowMs - latestArtifactMs;
  if (age <= windowMs) return "fresh";
  if (age <= 2 * windowMs) return "stale";
  return "missing";
}

function detailFor(verdict: RoutineVerdict, cadence: string): string | null {
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
