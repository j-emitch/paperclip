/**
 * Shared projection helpers — pure folds over a `SignalBundle` that every
 * projection needs: per-(source,repo) freshness aggregation and the derived
 * diagnostics. Kept in one place so the board / artifact / routine projections
 * report staleness identically.
 *
 * Projections are PURE (no ctx, no I/O): they take the already-collected bundle
 * and an injected `nowMs`, and return a persisted contract. That is what lets
 * `collectAndProject` be deterministic + golden-testable, and what the COS-0d
 * worker calls under the cache lock after `collect`.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import type { Diagnostic, SourceFreshness } from "../contracts/diagnostics.js";

/** ISO-8601 from epoch ms — the single time formatter every projection uses. */
export function isoFrom(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Aggregate every batch's `repoFreshness` into the flat `SourceFreshness[]` the
 * projections embed. One row per (source, repo); `message` summarizes the first
 * error for the badge tooltip.
 */
export function aggregateSourceFreshness(bundle: SignalBundle): SourceFreshness[] {
  const out: SourceFreshness[] = [];
  for (const batch of bundle.batches) {
    for (const rf of batch.repoFreshness) {
      out.push({
        source: batch.source,
        repo: rf.repo,
        freshness: rf.freshness,
        lastOkAt: rf.lastOkAt,
        errorCount: rf.errors.length,
        message: rf.errors[0]?.message ?? null,
      });
    }
  }
  // Stable order: by source then repo (deterministic snapshots).
  out.sort((a, b) => a.source.localeCompare(b.source) || a.repo.localeCompare(b.repo));
  return out;
}

/**
 * Derive projection-level diagnostics from the source freshness: a stale source
 * becomes a `warn`, surfacing "why is this column last-good" without re-reading.
 */
export function diagnosticsFromFreshness(freshness: readonly SourceFreshness[]): Diagnostic[] {
  return freshness
    .filter((f) => f.freshness === "stale")
    .map((f) => ({
      level: "warn" as const,
      code: "source_stale",
      message: f.message ?? `${f.source} · ${f.repo} is stale`,
      repo: f.repo,
      source: f.source,
    }));
}
