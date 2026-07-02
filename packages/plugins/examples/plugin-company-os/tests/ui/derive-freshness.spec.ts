import { describe, expect, it } from "vitest";
import type { SourceFreshness } from "../../src/contracts/index.js";
import {
  CLOCK_SKEW_TOLERANCE_MS,
  SURFACE_STALE_THRESHOLD_MS,
  deriveAgeMs,
  deriveFreshness,
  deriveSkewMs,
  isClockSkewed,
  isStale,
  staleSources,
} from "../../src/ui/shared/derive-freshness.js";

const NOW = Date.parse("2026-07-02T12:00:00.000Z");
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

const src = (over: Partial<SourceFreshness> = {}): SourceFreshness => ({
  source: "git-work",
  repo: "juice-bar",
  freshness: "live",
  lastOkAt: iso(0),
  errorCount: 0,
  message: null,
  ...over,
});

const input = (derivedAt: string, sources: SourceFreshness[] = []) => ({ derivedAt, sources });

describe("derive-freshness — the one shared surface-freshness math", () => {
  it("deriveAgeMs: age is now − derivedAt, clamped to 0, +Infinity on garbage", () => {
    expect(deriveAgeMs(input(iso(-1000)), NOW)).toBe(1000);
    expect(deriveAgeMs(input(iso(0)), NOW)).toBe(0);
    // A derive stamped in the future clamps to 0 (never negative age).
    expect(deriveAgeMs(input(iso(5000)), NOW)).toBe(0);
    expect(deriveAgeMs(input("not-a-date"), NOW)).toBe(Number.POSITIVE_INFINITY);
  });

  it("deriveSkewMs: signed derivedAt − now, 0 on garbage", () => {
    expect(deriveSkewMs(input(iso(2000)), NOW)).toBe(2000);
    expect(deriveSkewMs(input(iso(-2000)), NOW)).toBe(-2000);
    expect(deriveSkewMs(input("garbage"), NOW)).toBe(0);
  });

  it("isClockSkewed: true only strictly past the tolerance", () => {
    expect(isClockSkewed(input(iso(CLOCK_SKEW_TOLERANCE_MS)), NOW)).toBe(false); // == tolerance, not over
    expect(isClockSkewed(input(iso(CLOCK_SKEW_TOLERANCE_MS + 1)), NOW)).toBe(true);
    expect(isClockSkewed(input(iso(-999_999)), NOW)).toBe(false); // past is never skew
  });

  it("isStale: flips strictly past the 5-minute threshold", () => {
    expect(SURFACE_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
    expect(isStale(input(iso(-SURFACE_STALE_THRESHOLD_MS)), NOW)).toBe(false); // == threshold, not over
    expect(isStale(input(iso(-SURFACE_STALE_THRESHOLD_MS - 1)), NOW)).toBe(true);
    // A clock-skewed (future) derive is NOT stale — age clamps to 0.
    expect(isStale(input(iso(10 * 60 * 1000)), NOW)).toBe(false);
  });

  it("staleSources: only the non-live sources, in order", () => {
    const sources = [src({ repo: "a", freshness: "live" }), src({ repo: "b", freshness: "stale" }), src({ repo: "c", freshness: "cached" })];
    expect(staleSources(input(iso(0), sources)).map((s) => s.repo)).toEqual(["b", "c"]);
    expect(staleSources(input(iso(0), [src({ freshness: "live" })]))).toEqual([]);
  });

  it("deriveFreshness: one pass returns the whole verdict", () => {
    const fresh = deriveFreshness(input(iso(-1000), [src({ freshness: "live" })]), NOW);
    expect(fresh).toMatchObject({ stale: false, skewed: false, staleSourceCount: 0, ageMs: 1000 });

    const stale = deriveFreshness(input(iso(-SURFACE_STALE_THRESHOLD_MS - 1000), [src({ freshness: "stale" }), src({ repo: "x", freshness: "live" })]), NOW);
    expect(stale).toMatchObject({ stale: true, skewed: false, staleSourceCount: 1 });
    expect(stale.staleSources.map((s) => s.repo)).toEqual(["juice-bar"]);

    const skewed = deriveFreshness(input(iso(CLOCK_SKEW_TOLERANCE_MS + 5000), []), NOW);
    expect(skewed).toMatchObject({ skewed: true, stale: false });
    expect(skewed.skewMs).toBeGreaterThan(CLOCK_SKEW_TOLERANCE_MS);
  });
});
