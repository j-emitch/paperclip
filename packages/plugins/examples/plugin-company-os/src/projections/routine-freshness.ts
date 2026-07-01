/**
 * Routine-freshness math — the cadence-window + SLO-verdict logic shared by
 * `deriveRoutineHealth` (the Agents cockpit) and `deriveOrientation` (the Home
 * pinned briefing), extracted so the two surfaces can never disagree on what
 * "fresh / stale / missing" means (PF-3a). Behavior-preserving: `cadenceWindowMs`
 * / `computeVerdict` / `MS` / `artifactMs` are moved verbatim, and the matching +
 * last-activity fold is lifted into `evaluateRoutine` (the per-routine core both
 * projections call). The routine-health tests stay green unchanged.
 *
 * Verdict ladder — ARTIFACT-centric (freshness is whether the EXPECTED ARTIFACT
 * was produced recently, not merely whether the agent ran):
 *   never_ran — no artifact ever AND no last-run
 *   fresh     — newest ARTIFACT mtime within W
 *   stale     — newest ARTIFACT mtime within (W, 2W]
 *   missing   — newest ARTIFACT mtime older than 2W, OR a last-run with no artifact
 */

import type { ArtifactSignal, RoutineSignal } from "../contracts/signals.js";
import type { FreshnessKind, RoutineVerdict } from "../contracts/vocab.js";
import { matchesAnyGlob } from "../sources/glob.js";
import { normalizeProvenance } from "./provenance.js";

export const MS = { hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };

/** Cadence token → window in ms; null when uncomputable (a cron string). */
export function cadenceWindowMs(cadence: string): number | null {
  const c = cadence.trim().toLowerCase();
  if (c === "hourly") return MS.hour;
  if (c === "daily") return MS.day;
  if (c === "weekly") return MS.week;
  if (c === "monthly") return MS.month;
  return null; // cron / unknown — verdict falls back to presence
}

export function artifactMs(a: ArtifactSignal): number {
  const t = a.mtime ? Date.parse(a.mtime) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Artifact-centric verdict: freshness is about whether the EXPECTED ARTIFACT was
 * produced recently, not merely whether the agent ran. A recent `lastRunAt` with
 * no artifact is `missing` (ran, produced nothing), never `fresh`.
 */
export function computeVerdict(
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

/** The per-routine freshness core: latest matching artifact + activity + verdict. */
export interface RoutineEvaluation {
  readonly verdict: RoutineVerdict | null;
  readonly freshnessKind: FreshnessKind;
  /** The newest artifact matching the routine's expected glob (mtime-desc), if any. */
  readonly latest: ArtifactSignal | undefined;
  /** Newest activity (max of lastRunAt + latest artifact mtime), epoch ms; -Infinity = none. */
  readonly lastActivity: number;
  /** True when an artifact exists AND is within the cadence window (or cron presence-only). */
  readonly present: boolean;
}

/** Evaluate one routine contract against the artifact set — the shared fold. */
export function evaluateRoutine(
  routine: RoutineSignal,
  artifacts: readonly ArtifactSignal[],
  nowMs: number,
): RoutineEvaluation {
  const freshnessKind = routine.freshnessKind ?? "artifact";
  if (freshnessKind === "embedded") {
    return { verdict: null, freshnessKind, latest: undefined, lastActivity: -Infinity, present: false };
  }
  const sourceGlob = freshnessKind === "proposal" ? routine.proposalSource ?? routine.expectedArtifactGlob : routine.expectedArtifactGlob;
  // The AGENTS glob is monorepo-parent-relative (`company/reports/...`) while an
  // ArtifactSignal.relPath is repo-relative, so match against `repo/relPath`.
  const matching = artifacts
    .filter((a) => matchesRoutineSource(a, routine, sourceGlob, freshnessKind))
    .sort((x, y) => artifactMs(y) - artifactMs(x));
  const latest = matching[0];

  const lastRunMs = routine.lastRunAt ? Date.parse(routine.lastRunAt) : NaN;
  const latestMs = latest ? artifactMs(latest) : NaN;
  const hasArtifact = Number.isFinite(latestMs);
  const lastActivity = Math.max(
    Number.isFinite(lastRunMs) ? lastRunMs : -Infinity,
    hasArtifact ? latestMs : -Infinity,
  );
  const hasActivity = lastActivity > -Infinity;
  const windowMs = cadenceWindowMs(routine.cadence);
  const verdict = computeVerdict(nowMs, latestMs, hasArtifact, hasActivity, windowMs);
  const present = hasArtifact && (windowMs === null || nowMs - latestMs <= windowMs);

  return { verdict, freshnessKind, latest, lastActivity, present };
}

function matchesRoutineSource(
  artifact: ArtifactSignal,
  routine: RoutineSignal,
  sourceGlob: string,
  freshnessKind: FreshnessKind,
): boolean {
  const relPath = `${artifact.repo}/${artifact.relPath}`;
  if (!matchesAnyGlob(relPath, [sourceGlob])) return false;
  if (freshnessKind === "proposal") return true;
  if (matchesAnyGlob(relPath, routine.exclude ?? [])) return false;
  if (artifact.createdBy == null) return true;
  return normalizeProvenance(artifact.createdBy) === routine.ownerAgent;
}
