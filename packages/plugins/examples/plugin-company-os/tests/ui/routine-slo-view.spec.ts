/**
 * Pure unit coverage for `computeRoutineSlo` — the shared per-routine display
 * fold behind `RoutineSloCard`. Both the Routines board and each AgentCard's
 * owned-routines drawer render the same SLO, so the overdue / verdict / artifact
 * derivation is proven once here, deterministic under an injected clock.
 */

import { describe, expect, it } from "vitest";
import { computeRoutineSlo, type RoutineSloView } from "../../src/ui/shared/routine-slo-view.js";

const NOW = Date.parse("2026-07-01T12:00:00Z");

function routine(overrides: Partial<RoutineSloView> = {}): RoutineSloView {
  return {
    routineKey: "daily-standup",
    displayName: "Daily Standup",
    cadence: "daily",
    freshnessKind: "artifact",
    expectedArtifactGlob: "company/reports/standup/*.md",
    lastRunAt: "2026-07-01T09:00:00Z",
    nextExpectedAt: "2026-07-02T09:00:00Z",
    expectedArtifactPresent: true,
    latestArtifactPath: "company/reports/standup/2026-07-01.md",
    verdict: "fresh",
    detail: null,
    ...overrides,
  };
}

describe("computeRoutineSlo", () => {
  it("folds a fresh artifact routine into a present, future-next display", () => {
    const d = computeRoutineSlo(routine(), NOW);
    expect(d.verdictLabel).toBe("Fresh");
    expect(d.lastRun).toBe("3h ago");
    expect(d.overdue).toBe(false);
    expect(d.next).toEqual({ label: "Next", value: "in 21h" });
    expect(d.artifact).toEqual({ kind: "artifact", present: true });
    expect(d.reference).toEqual({ kind: "path", value: "company/reports/standup/2026-07-01.md" });
    expect(d.tone).toBeTruthy();
  });

  it("labels a past next-expected as Overdue instead of a contradictory countdown", () => {
    const d = computeRoutineSlo(routine({ nextExpectedAt: "2026-06-25T09:00:00Z", verdict: "stale" }), NOW);
    expect(d.overdue).toBe(true);
    expect(d.next?.label).toBe("Overdue");
    expect(d.next?.value).toBe("6d ago");
  });

  it("renders an embedded duty as a neutral duties-only slot (null verdict)", () => {
    const d = computeRoutineSlo(
      routine({
        freshnessKind: "embedded",
        expectedArtifactGlob: "",
        verdict: null,
        expectedArtifactPresent: false,
        latestArtifactPath: null,
        nextExpectedAt: null,
      }),
      NOW,
    );
    expect(d.verdictLabel).toBe("Duties only");
    expect(d.artifact).toEqual({ kind: "embedded" });
    expect(d.next).toBeNull();
    expect(d.reference).toBeNull();
  });

  it("says 'never' when a routine has no observed last run", () => {
    expect(computeRoutineSlo(routine({ lastRunAt: null }), NOW).lastRun).toBe("never");
  });

  it("falls back to the expected glob when no artifact has landed yet", () => {
    const d = computeRoutineSlo(routine({ latestArtifactPath: null, expectedArtifactPresent: false }), NOW);
    expect(d.reference).toEqual({ kind: "glob", value: "company/reports/standup/*.md" });
    expect(d.artifact).toEqual({ kind: "artifact", present: false });
  });

  it("marks a proposal-kind routine distinctly from an artifact routine", () => {
    expect(computeRoutineSlo(routine({ freshnessKind: "proposal" }), NOW).artifact).toEqual({
      kind: "proposal",
      present: true,
    });
  });
});
