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
import { BRANCH_STATUSES, HEALTH_SEVERITIES, type HealthSeverity } from "../../src/contracts/vocab.js";
// The UI-side "browser twin" of the severity order/predicate (git-labels can't value-import
// contracts per the COS-0 boundary). This test pins the twin to the source so they can't drift.
import { HEALTH_SEVERITY_ORDER as UI_ORDER, isAttentionSeverity as uiIsAttention } from "../../src/ui/shared/git-labels.js";
import { HEALTH_SEVERITY_ORDER as SRC_ORDER, isAttentionSeverity as srcIsAttention } from "../../src/contracts/branch-health.js";

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

// The Branch·PR view reads the persisted `attentionSeverity` (computed via the contract
// source) but orders + filters the band with the UI-side twin in `git-labels`. If the twin
// drifts from the source, Home's "N need attention" count and the band would silently diverge.
describe("UI severity twin parity (Home count ≡ Branch·PR band invariant)", () => {
  it("git-labels HEALTH_SEVERITY_ORDER matches contracts/branch-health for every severity", () => {
    for (const s of HEALTH_SEVERITIES) {
      expect(UI_ORDER[s]).toBe(SRC_ORDER[s]);
    }
  });

  it("git-labels isAttentionSeverity matches contracts/branch-health for every severity", () => {
    for (const s of HEALTH_SEVERITIES) {
      expect(uiIsAttention(s)).toBe(srcIsAttention(s));
    }
  });
});
