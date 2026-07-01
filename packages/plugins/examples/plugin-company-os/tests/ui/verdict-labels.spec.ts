/**
 * Shared routine-verdict display vocabulary — the single home for the SLO verdict
 * label + tone maps and the nullable-verdict render helpers. Home's pinned
 * briefing, the Agents cockpit roster/drawers, and the shared `RoutineSloCard` all
 * read them, so this pins that every contract `RoutineVerdict` has a label + an
 * oklch tone, and that the null ("duties only, no SLO") path renders calm rather
 * than crashing. (Coverage re-homed here from the retired routines-view-model spec
 * when the Agents cockpit subsumed the standalone routine board — COS-1R-f.)
 */

import { describe, expect, it } from "vitest";
import { ROUTINE_VERDICTS } from "../../src/contracts/vocab.js";
import {
  VERDICT_LABELS,
  VERDICT_TONES,
  labelForNullableVerdict,
  toneForNullableVerdict,
} from "../../src/ui/shared/verdict-labels.js";

describe("verdict-labels", () => {
  it("gives every contract verdict a non-empty label + an oklch tone", () => {
    for (const v of ROUTINE_VERDICTS) {
      expect(VERDICT_LABELS[v]).toBeTruthy();
      expect(VERDICT_TONES[v]).toMatch(/oklch/);
    }
  });

  it("passes a concrete verdict through the nullable helpers unchanged", () => {
    for (const v of ROUTINE_VERDICTS) {
      expect(labelForNullableVerdict(v)).toBe(VERDICT_LABELS[v]);
      expect(toneForNullableVerdict(v)).toBe(VERDICT_TONES[v]);
    }
  });

  it("renders the null (embedded duty, no SLO) case as a calm 'Duties only'", () => {
    expect(labelForNullableVerdict(null)).toBe("Duties only");
    expect(toneForNullableVerdict(null)).toMatch(/oklch/);
  });
});
