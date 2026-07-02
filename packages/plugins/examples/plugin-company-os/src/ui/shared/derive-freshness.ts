/**
 * Surface freshness — the ONE place the cockpit computes "how old is this derive
 * and is any source degraded". Board, Atlas, and Branch·PR all persist the same
 * two fields (`derivedAt` + `sources[]`), so the staleness math + the clock-skew
 * tolerance live here once instead of drifting across three view-models. Every
 * surface's freshness badge reads this, so "derived 3m ago · stale" means exactly
 * the same thing on every tab.
 *
 * Pure functions of a projection shape + an injected `now` clock (no `Date.now()`),
 * so they're deterministic under test + SSR. Contract TYPES only — no React, no
 * sources, no projections, no Node — honouring the COS-0 import boundary.
 *
 * Consumed by `atlas-view-model` / `board/view-model` (which re-export the surface
 * aliases their tests already import) and by the shared `SurfaceFreshnessBadge`.
 */

import type { SourceFreshness } from "../../contracts/index.js";

/** A surface is "stale" (surface-level badge) when its derive is older than this. */
export const SURFACE_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** A derive timestamp more than this far in the future is treated as clock skew, not "live". */
export const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

/** The minimal shape every derive stamps — the only field the age/skew math reads. */
export interface HasDerivedAt {
  readonly derivedAt: string;
}

/** A projection's freshness inputs: its derive stamp + its per-source freshness. */
export interface FreshnessInput extends HasDerivedAt {
  readonly sources: readonly SourceFreshness[];
}

/** Signed skew: derivedAt − now. Positive ⇒ the derive is stamped in the future. NaN stamp → 0. */
export function deriveSkewMs(input: HasDerivedAt, now: number): number {
  const derivedAt = Date.parse(input.derivedAt);
  if (Number.isNaN(derivedAt)) return 0;
  return derivedAt - now;
}

/** Age of the derive in ms relative to `now`; never negative (clock skew → 0). NaN stamp → +Infinity. */
export function deriveAgeMs(input: HasDerivedAt, now: number): number {
  const derivedAt = Date.parse(input.derivedAt);
  if (Number.isNaN(derivedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - derivedAt);
}

/** True when the derive is stamped far enough in the future to be clock skew rather than "live". */
export function isClockSkewed(input: HasDerivedAt, now: number): boolean {
  return deriveSkewMs(input, now) > CLOCK_SKEW_TOLERANCE_MS;
}

/** Surface-level staleness — the derive is older than the shared threshold. */
export function isStale(input: HasDerivedAt, now: number): boolean {
  return deriveAgeMs(input, now) > SURFACE_STALE_THRESHOLD_MS;
}

/** Sources that are not `live` — drive the per-source stale pills + the summary count. */
export function staleSources(input: { readonly sources: readonly SourceFreshness[] }): SourceFreshness[] {
  return input.sources.filter((s) => s.freshness !== "live");
}

/** The full freshness verdict for a surface — one call, everything the badge needs. */
export interface SurfaceFreshness {
  /** Derive age in ms (0 under clock skew, +Infinity if the stamp is unparseable). */
  ageMs: number;
  /** Signed skew in ms (positive ⇒ stamped in the future). */
  skewMs: number;
  /** The derive is stamped in the (implausible) future — surfaced as "clock skew", not "live". */
  skewed: boolean;
  /** The derive is older than the stale threshold. */
  stale: boolean;
  /** The non-live sources, in projection order. */
  staleSources: SourceFreshness[];
  /** Count of non-live sources — the badge's "N sources not live" cue. */
  staleSourceCount: number;
}

/** Compute the whole freshness verdict for a projection in one pass. */
export function deriveFreshness(input: FreshnessInput, now: number): SurfaceFreshness {
  const stales = staleSources(input);
  return {
    ageMs: deriveAgeMs(input, now),
    skewMs: deriveSkewMs(input, now),
    skewed: isClockSkewed(input, now),
    stale: isStale(input, now),
    staleSources: stales,
    staleSourceCount: stales.length,
  };
}
