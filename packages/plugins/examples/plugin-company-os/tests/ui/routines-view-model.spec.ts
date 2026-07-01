/**
 * Pure Routines view-model — verdict grouping, worst-first ordering, agent
 * grouping in canonical order, and tallies. Runs the real golden
 * `RoutineHealthV1` (one routine of each verdict) through `buildRoutinesView`.
 */

import { describe, expect, it } from "vitest";
import {
  buildRoutinesView,
  emptyVerdictCounts,
  VERDICT_LABELS,
  VERDICT_TONES,
  VERDICT_ORDER,
} from "../../src/ui/routines/routines-view-model.js";
import { labelForNullableVerdict, toneForNullableVerdict } from "../../src/ui/shared/verdict-labels.js";
import type { RoutineHealthV1 } from "../../src/contracts/index.js";
import { goldenRoutineHealth } from "./fixtures/reports.js";

describe("buildRoutinesView", () => {
  const health = goldenRoutineHealth();

  it("the golden fixture produces one routine of each verdict", () => {
    const view = buildRoutinesView(health);
    expect(view.total).toBe(4);
    expect(view.counts).toEqual({ fresh: 1, stale: 1, missing: 1, never_ran: 1 });
  });

  it("groups routines by owning agent in canonical CEO→COO→CTO→Librarian order", () => {
    const view = buildRoutinesView(health);
    const agents = view.groups.map((g) => g.ownerAgent);
    // The fixture has one routine per agent.
    expect(agents).toEqual(["CEO", "COO", "CTO", "Librarian"]);
  });

  it("computes the healthy percentage from fresh routines", () => {
    const view = buildRoutinesView(health);
    expect(view.healthyPct).toBe(25); // 1 of 4 fresh
  });

  it("sorts routines within a group worst-verdict-first", () => {
    // Build a single-agent health with mixed verdicts to exercise the sort.
    const multi: RoutineHealthV1 = {
      ...health,
      routines: [
        mk("a-fresh", "CTO", "fresh"),
        mk("b-missing", "CTO", "missing"),
        mk("c-stale", "CTO", "stale"),
        mk("d-never", "CTO", "never_ran"),
      ],
    };
    const view = buildRoutinesView(multi);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].routines.map((r) => r.verdict)).toEqual(["missing", "stale", "never_ran", "fresh"]);
  });

  it("exposes a tone + label for every verdict, and a worst-first order", () => {
    for (const v of VERDICT_ORDER) {
      expect(VERDICT_LABELS[v]).toBeTruthy();
      expect(VERDICT_TONES[v]).toMatch(/oklch/);
    }
    expect(VERDICT_ORDER).toEqual(["missing", "stale", "never_ran", "fresh"]);
  });

  it("exposes calm nullable-verdict helpers before any contract widens", () => {
    expect(labelForNullableVerdict("fresh")).toBe(VERDICT_LABELS.fresh);
    expect(toneForNullableVerdict("fresh")).toBe(VERDICT_TONES.fresh);
    expect(labelForNullableVerdict(null)).toBe("Duties only");
    expect(toneForNullableVerdict(null)).toMatch(/oklch/);
  });

  it("handles an empty health snapshot without throwing", () => {
    const empty: RoutineHealthV1 = { ...health, routines: [] };
    const view = buildRoutinesView(empty);
    expect(view.total).toBe(0);
    expect(view.groups).toEqual([]);
    expect(view.healthyPct).toBe(0);
    expect(view.counts).toEqual(emptyVerdictCounts());
  });
});

function mk(routineKey: string, ownerAgent: string, verdict: "fresh" | "stale" | "missing" | "never_ran"): RoutineHealthV1["routines"][number] {
  return {
    routineKey,
    displayName: routineKey,
    ownerAgent,
    cadence: "daily",
    expectedArtifactGlob: "company/reports/x/**",
    lastRunAt: null,
    nextExpectedAt: null,
    expectedArtifactPresent: verdict === "fresh",
    latestArtifactPath: null,
    latestArtifactMtime: null,
    verdict,
    detail: null,
  };
}
