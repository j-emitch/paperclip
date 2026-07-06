/**
 * COS-2f — `deriveTeachingOverview` pure-fold tests. Builds teaching signal
 * bundles directly (independent of the source) and pins the fold: backlog totals
 * + oldest age, the synthesis freshness ladder, the unit facet counts, and — the
 * heart of COS-2 — the `attention` headline that turns CRITICAL when a backlog
 * piles up behind a stalled synthesis (the real 199-nugget failure mode).
 */

import { describe, expect, it } from "vitest";
import { deriveTeachingOverview } from "../../src/projections/deriveTeachingOverview.js";
import type { SignalBatch, SignalBundle } from "../../src/contracts/WorkSignalSource.js";
import type { ArtifactSignal, TeachingArtifactMeta } from "../../src/contracts/signals.js";
import type { TeachingAudience, TeachingLens, TeachingPublishState } from "../../src/contracts/index.js";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const H = 3_600_000;

function meta(over: Partial<TeachingArtifactMeta> & Pick<TeachingArtifactMeta, "entryKind">): TeachingArtifactMeta {
  return { lens: null, audience: null, publishState: null, unit: null, pendingNuggets: null, lastVerified: null, ...over };
}

function sig(relPath: string, mtime: string | null, teaching: TeachingArtifactMeta): ArtifactSignal {
  return {
    kind: "artifact", source: "teaching", repo: "company", path: relPath, relPath,
    mtime: mtime ?? undefined, confidence: "high", freshness: "live", errors: [],
    artifactType: "teaching", system: "Company", prefix: null, status: null,
    sha256: "x", sizeBytes: 1, title: relPath, createdBy: null, teaching,
  };
}

function inbox(relPath: string, ageHours: number, nuggets: number): ArtifactSignal {
  return sig(relPath, new Date(NOW - ageHours * H).toISOString(), meta({ entryKind: "inbox", pendingNuggets: nuggets }));
}
function synth(ageHours: number): ArtifactSignal {
  return sig(`reports/routine-runs/x/librarian.teachings-synthesis.json`, new Date(NOW - ageHours * H).toISOString(), meta({ entryKind: "synthesis" }));
}
function unit(relPath: string, lens: TeachingLens, audience: TeachingAudience, publishState: TeachingPublishState): ArtifactSignal {
  return sig(relPath, "2026-07-01T00:00:00.000Z", meta({ entryKind: "unit", lens, audience, publishState, unit: "01-x" }));
}

function bundle(signals: ArtifactSignal[], freshness: SignalBatch["repoFreshness"] = [{ repo: "company", freshness: "live", lastOkAt: null, errors: [] }]): SignalBundle {
  return { collectedAt: NOW, batches: [{ source: "teaching", collectedAt: NOW, signals, repoFreshness: freshness }] };
}

describe("deriveTeachingOverview — backlog", () => {
  it("sums pending nuggets + logs and finds the oldest age", () => {
    const o = deriveTeachingOverview(bundle([inbox("a.md", 48, 2), inbox("b.md", 10, 3)]), NOW);
    expect(o.backlog.pendingLogs).toBe(2);
    expect(o.backlog.pendingNuggets).toBe(5);
    expect(o.backlog.oldestPendingAt).toBe(new Date(NOW - 48 * H).toISOString());
    expect(o.backlog.oldestPendingAgeHours).toBeCloseTo(48, 5);
  });

  it("reports an empty backlog when the inbox is drained", () => {
    const o = deriveTeachingOverview(bundle([unit("u.md", "internal", "internal", "ready")]), NOW);
    expect(o.backlog).toMatchObject({ pendingLogs: 0, pendingNuggets: 0, oldestPendingAt: null, oldestPendingAgeHours: null });
  });
});

describe("deriveTeachingOverview — synthesis freshness ladder", () => {
  it("fresh within 72h, stale within a week, missing beyond, never_ran with no receipt", () => {
    expect(deriveTeachingOverview(bundle([synth(1)]), NOW).synthesis.verdict).toBe("fresh");
    expect(deriveTeachingOverview(bundle([synth(100)]), NOW).synthesis.verdict).toBe("stale");
    expect(deriveTeachingOverview(bundle([synth(200)]), NOW).synthesis.verdict).toBe("missing");
    expect(deriveTeachingOverview(bundle([]), NOW).synthesis.verdict).toBe("never_ran");
  });

  it("picks the NEWEST synthesis receipt", () => {
    const o = deriveTeachingOverview(bundle([synth(200), synth(2)]), NOW);
    expect(o.synthesis.verdict).toBe("fresh");
    expect(o.synthesis.ageHours).toBeCloseTo(2, 5);
  });
});

describe("deriveTeachingOverview — attention headline (the COS-2 signal)", () => {
  it("CRITICAL when a backlog sits behind a stalled synthesis", () => {
    const o = deriveTeachingOverview(bundle([inbox("a.md", 240, 199), synth(200)]), NOW);
    expect(o.attention.level).toBe("critical");
    expect(o.attention.reason).toMatch(/199 nuggets/);
    expect(o.diagnostics.some((d) => d.code === "teaching_backlog_stuck")).toBe(true);
  });

  it("CRITICAL when a backlog exists and synthesis has never run (the 199 stall)", () => {
    const o = deriveTeachingOverview(bundle([inbox("a.md", 240, 199)]), NOW);
    expect(o.attention.level).toBe("critical");
    expect(o.attention.reason).toMatch(/never run/);
  });

  it("ATTENTION (not critical) when a backlog sits behind a FRESH synthesis", () => {
    const o = deriveTeachingOverview(bundle([inbox("a.md", 1, 4), synth(1)]), NOW);
    expect(o.attention.level).toBe("attention");
    expect(o.diagnostics.some((d) => d.code === "teaching_backlog_stuck")).toBe(false);
  });

  it("OK when the backlog is drained", () => {
    const o = deriveTeachingOverview(bundle([synth(200), unit("u.md", "internal", "internal", "ready")]), NOW);
    expect(o.attention.level).toBe("ok");
    expect(o.attention.reason).toBeNull();
  });

  it("ATTENTION when a source is stale even with no backlog", () => {
    const b = bundle([unit("u.md", "internal", "internal", "ready")], [{ repo: "company", freshness: "stale", lastOkAt: null, errors: [] }]);
    const o = deriveTeachingOverview(b, NOW);
    expect(o.attention.level).toBe("attention");
    expect(o.attention.reason).toMatch(/stale/);
  });
});

describe("deriveTeachingOverview — unit facet counts", () => {
  it("tallies audience, publish state, and lens", () => {
    const o = deriveTeachingOverview(
      bundle([
        unit("a.md", "internal", "internal", "private"),
        unit("b.md", "external", "external", "published"),
        unit("c.md", "unspecified", "both", "candidate"),
      ]),
      NOW,
    );
    expect(o.unitCounts.total).toBe(3);
    expect(o.unitCounts.audience).toMatchObject({ internal: 1, external: 1, both: 1 });
    expect(o.unitCounts.publishState).toMatchObject({ private: 1, candidate: 1, ready: 0, published: 1 });
    expect(o.unitCounts.lens).toMatchObject({ internal: 1, external: 1, unspecified: 1 });
    expect(o.units).toHaveLength(3);
  });

  it("an empty corpus folds to a valid all-zero overview", () => {
    const o = deriveTeachingOverview(bundle([]), NOW);
    expect(o.unitCounts.total).toBe(0);
    expect(o.units).toEqual([]);
    expect(o.synthesis.verdict).toBe("never_ran");
    expect(o.attention.level).toBe("ok");
  });
});
