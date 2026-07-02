/**
 * The shared branch-health severity (COS-5e) — the ONE definition Home's digest and
 * the Branch·PR Health view both read, so it can't drift between them.
 */

import { describe, expect, it } from "vitest";
import {
  BRANCH_STATUS_SEVERITY,
  branchStatusSeverity,
  compareSeverityWorstFirst,
  isAttentionSeverity,
} from "../../src/contracts/branch-health.js";
import { BRANCH_STATUSES, type HealthSeverity } from "../../src/contracts/vocab.js";

describe("branchStatusSeverity", () => {
  it("takes the WORST severity across a branch's statuses", () => {
    expect(branchStatusSeverity(["dirty", "conflicting", "stale"])).toBe("high"); // conflicting wins
    expect(branchStatusSeverity(["behind", "dirty"])).toBe("medium");
    expect(branchStatusSeverity(["comparison_unavailable"])).toBe("low");
    expect(branchStatusSeverity(["ahead_clean"])).toBe("info");
  });

  it("is `info` when there is nothing to flag", () => {
    expect(branchStatusSeverity([])).toBe("info");
  });

  it("has a severity for every canonical branch status (no drift)", () => {
    for (const s of BRANCH_STATUSES) {
      expect(BRANCH_STATUS_SEVERITY[s]).toBeDefined();
    }
  });
});

describe("isAttentionSeverity", () => {
  it("is true only for high + medium (the Home / band attention set)", () => {
    expect(isAttentionSeverity("high")).toBe(true);
    expect(isAttentionSeverity("medium")).toBe(true);
    expect(isAttentionSeverity("low")).toBe(false);
    expect(isAttentionSeverity("info")).toBe(false);
  });
});

describe("compareSeverityWorstFirst", () => {
  it("orders worst (high) before least (info)", () => {
    const sorted = (["info", "high", "low", "medium"] as HealthSeverity[]).sort(compareSeverityWorstFirst);
    expect(sorted).toEqual(["high", "medium", "low", "info"]);
  });
});
