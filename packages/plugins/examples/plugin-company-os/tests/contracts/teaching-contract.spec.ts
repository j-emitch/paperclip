/**
 * COS-2f — `TeachingOverviewV1` contract validation. The live payload crosses the
 * worker→UI bridge, so it is zod-validated on the way out; these pin that a valid
 * overview round-trips and malformed ones (bad verdict, wrong schemaVersion, a
 * typo'd facet-count key) are rejected rather than rendered.
 */

import { describe, expect, it } from "vitest";
import {
  parseTeachingOverviewV1,
  safeParseTeachingOverviewV1,
  TEACHING_OVERVIEW_SCHEMA_VERSION,
} from "../../src/contracts/teaching.js";

function valid() {
  return {
    schemaVersion: TEACHING_OVERVIEW_SCHEMA_VERSION,
    derivedAt: "2026-07-02T00:00:00.000Z",
    backlog: { pendingLogs: 1, pendingNuggets: 4, oldestPendingAt: "2026-06-28T00:00:00.000Z", oldestPendingAgeHours: 96 },
    synthesis: { lastSynthesisAt: null, ageHours: null, verdict: "never_ran" as const },
    attention: { level: "critical" as const, reason: "4 nuggets awaiting synthesis" },
    units: [
      {
        repo: "company", relPath: "docs/teachings/internal/units/01-x/a.md", title: "A",
        unit: "01-x", lens: "internal" as const, audience: "internal" as const,
        publishState: "private" as const, lastVerifiedAt: null, mtime: "2026-07-01T00:00:00.000Z",
      },
    ],
    unitCounts: {
      total: 1,
      audience: { internal: 1, external: 0, both: 0 },
      publishState: { private: 1, candidate: 0, ready: 0, published: 0 },
      lens: { internal: 1, external: 0, unspecified: 0 },
    },
    sources: [],
    diagnostics: [],
  };
}

describe("TeachingOverviewV1 contract", () => {
  it("round-trips a valid overview", () => {
    const parsed = parseTeachingOverviewV1(valid());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.attention.level).toBe("critical");
  });

  it("rejects a bad synthesis verdict", () => {
    const bad = { ...valid(), synthesis: { lastSynthesisAt: null, ageHours: null, verdict: "sorta_fresh" } };
    expect(() => parseTeachingOverviewV1(bad)).toThrow();
    expect(safeParseTeachingOverviewV1(bad).success).toBe(false);
  });

  it("rejects a wrong schemaVersion (forces a re-read)", () => {
    expect(safeParseTeachingOverviewV1({ ...valid(), schemaVersion: 2 }).success).toBe(false);
  });

  it("rejects an out-of-vocab audience on a unit", () => {
    const v = valid();
    const bad = { ...v, units: [{ ...v.units[0], audience: "public" }] };
    expect(safeParseTeachingOverviewV1(bad).success).toBe(false);
  });

  it("rejects a typo'd facet-count key", () => {
    const v = valid();
    const bad = { ...v, unitCounts: { ...v.unitCounts, publishState: { private: 1, candidate: 0, ready: 0, publishd: 0 } } };
    expect(safeParseTeachingOverviewV1(bad).success).toBe(false);
  });
});
