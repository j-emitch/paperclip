/**
 * `deriveTeachingOverview` — the PURE fold behind the Teaching tab (COS-2f). It
 * takes the `SignalBundle` a `TeachingSource` produced (teaching `ArtifactSignal`s
 * carrying `TeachingArtifactMeta`) + an injected `nowMs`, and folds it into the
 * live `TeachingOverviewV1` payload. No ctx, no I/O, no clock of its own — so the
 * worker's `teaching-overview` handler runs it deterministically and the golden
 * tests pin its output, exactly like the three cached projections.
 *
 * The headline it computes is the whole point of COS-2: a non-empty inbox backlog
 * whose synthesis has gone stale/missing is the "silently broken loop" failure
 * mode (the real 199-nugget stall) — surfaced as `attention.level: "critical"`.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import { isArtifactSignal, type ArtifactSignal, type TeachingArtifactMeta } from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import {
  TEACHING_OVERVIEW_SCHEMA_VERSION,
  type TeachingAttention,
  type TeachingBacklog,
  type TeachingOverviewV1,
  type TeachingSynthesis,
  type TeachingUnitCounts,
  type TeachingUnitEntry,
} from "../contracts/teaching.js";
import type { RoutineVerdict } from "../contracts/vocab.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

const HOUR_MS = 3_600_000;

/**
 * Synthesis freshness thresholds (hours). The teaching loop synthesizes when a
 * backlog accrues rather than on a fixed cadence, so these are generous: a
 * receipt within 3 days is fresh, within a week stale, older is missing.
 */
const SYNTH_FRESH_H = 72;
const SYNTH_STALE_H = 168;

/** A teaching artifact + its (guaranteed-present) meta — the fold's working unit. */
interface TeachingSig {
  readonly sig: ArtifactSignal;
  readonly meta: TeachingArtifactMeta;
}

export function deriveTeachingOverview(bundle: SignalBundle, nowMs: number): TeachingOverviewV1 {
  const teaching: TeachingSig[] = bundle.batches
    .flatMap((b) => b.signals)
    .filter(isArtifactSignal)
    .flatMap((sig) => (sig.teaching ? [{ sig, meta: sig.teaching }] : []));

  const backlog = foldBacklog(teaching, nowMs);
  const synthesis = foldSynthesis(teaching, nowMs);
  const units = foldUnits(teaching);
  const unitCounts = countUnits(units);
  const attention = deriveAttention(backlog, synthesis, bundle);

  const sources = aggregateSourceFreshness(bundle);
  const diagnostics: Diagnostic[] = [...diagnosticsFromFreshness(sources)];
  if (attention.level === "critical") {
    diagnostics.push({
      level: "error",
      code: "teaching_backlog_stuck",
      message: attention.reason ?? "teaching backlog is not being synthesized",
      repo: null,
      source: "teaching",
    });
  }

  return {
    schemaVersion: TEACHING_OVERVIEW_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    backlog,
    synthesis,
    attention,
    units,
    unitCounts,
    sources,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// backlog / synthesis / units
// ---------------------------------------------------------------------------

function msOf(sig: ArtifactSignal): number {
  const t = sig.mtime ? Date.parse(sig.mtime) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

function foldBacklog(teaching: readonly TeachingSig[], nowMs: number): TeachingBacklog {
  const inbox = teaching.filter((t) => t.meta.entryKind === "inbox");
  const pendingLogs = inbox.length;
  const pendingNuggets = inbox.reduce((sum, t) => sum + (t.meta.pendingNuggets ?? 0), 0);

  const oldestMs = inbox.reduce((min, t) => {
    const ms = msOf(t.sig);
    return Number.isFinite(ms) ? Math.min(min, ms) : min;
  }, Number.POSITIVE_INFINITY);

  const hasOldest = Number.isFinite(oldestMs);
  return {
    pendingLogs,
    pendingNuggets,
    oldestPendingAt: hasOldest ? isoFrom(oldestMs) : null,
    oldestPendingAgeHours: hasOldest ? Math.max(0, (nowMs - oldestMs) / HOUR_MS) : null,
  };
}

function foldSynthesis(teaching: readonly TeachingSig[], nowMs: number): TeachingSynthesis {
  const newestMs = teaching
    .filter((t) => t.meta.entryKind === "synthesis")
    .reduce((max, t) => {
      const ms = msOf(t.sig);
      return Number.isFinite(ms) ? Math.max(max, ms) : max;
    }, Number.NEGATIVE_INFINITY);

  if (!Number.isFinite(newestMs)) {
    return { lastSynthesisAt: null, ageHours: null, verdict: "never_ran" };
  }
  const ageHours = Math.max(0, (nowMs - newestMs) / HOUR_MS);
  return { lastSynthesisAt: isoFrom(newestMs), ageHours, verdict: verdictFor(ageHours) };
}

function verdictFor(ageHours: number): RoutineVerdict {
  if (ageHours <= SYNTH_FRESH_H) return "fresh";
  if (ageHours <= SYNTH_STALE_H) return "stale";
  return "missing";
}

function foldUnits(teaching: readonly TeachingSig[]): TeachingUnitEntry[] {
  return teaching
    .filter((t) => t.meta.entryKind === "unit")
    .map(({ sig, meta }): TeachingUnitEntry => ({
      repo: sig.repo,
      relPath: sig.relPath,
      // Last line of defense before the `title: min(1)` contract — never emit "".
      title: sig.title?.trim() || (sig.relPath.split("/").pop() ?? sig.relPath).replace(/\.md$/, ""),
      unit: meta.unit,
      lens: meta.lens ?? "unspecified",
      audience: meta.audience ?? "internal",
      publishState: meta.publishState ?? "private",
      lastVerifiedAt: meta.lastVerified,
      mtime: sig.mtime ?? null,
    }))
    .sort(
      (a, b) =>
        (a.unit ?? "~").localeCompare(b.unit ?? "~") ||
        a.title.localeCompare(b.title) ||
        a.relPath.localeCompare(b.relPath),
    );
}

function countUnits(units: readonly TeachingUnitEntry[]): TeachingUnitCounts {
  const counts: TeachingUnitCounts = {
    total: units.length,
    audience: { internal: 0, external: 0, both: 0 },
    publishState: { private: 0, candidate: 0, ready: 0, published: 0 },
    lens: { internal: 0, external: 0, unspecified: 0 },
  };
  for (const u of units) {
    counts.audience[u.audience] += 1;
    counts.publishState[u.publishState] += 1;
    counts.lens[u.lens] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// attention headline — the one signal COS-2 exists to make un-ignorable
// ---------------------------------------------------------------------------

function deriveAttention(
  backlog: TeachingBacklog,
  synthesis: TeachingSynthesis,
  bundle: SignalBundle,
): TeachingAttention {
  const hasBacklog = backlog.pendingNuggets > 0 || backlog.pendingLogs > 0;
  const synthesisLagging = synthesis.verdict === "stale" || synthesis.verdict === "missing" || synthesis.verdict === "never_ran";

  if (hasBacklog && synthesisLagging) {
    const n = backlog.pendingNuggets;
    const state = synthesis.verdict === "never_ran" ? "has never run" : `is ${synthesis.verdict}`;
    return {
      level: "critical",
      reason: `${n} nugget${n === 1 ? "" : "s"} across ${backlog.pendingLogs} log${backlog.pendingLogs === 1 ? "" : "s"} awaiting synthesis — the synthesis ${state}.`,
    };
  }
  if (hasBacklog) {
    const n = backlog.pendingNuggets;
    return {
      level: "attention",
      reason: `${n} nugget${n === 1 ? "" : "s"} queued; last synthesis is fresh — they'll drain on the next run.`,
    };
  }
  const staleSource = anyStaleSource(bundle);
  if (staleSource) {
    return { level: "attention", reason: `The ${staleSource} source is stale — counts may be last-good.` };
  }
  return { level: "ok", reason: null };
}

function anyStaleSource(bundle: SignalBundle): string | null {
  for (const batch of bundle.batches) {
    for (const rf of batch.repoFreshness) if (rf.freshness !== "live") return batch.source;
  }
  return null;
}
