/**
 * Pure view-model coverage for the Agents cockpit. `buildAgentSystemVm` folds the
 * persisted `AgentSystemV1` into the ordered roster + severity-sorted diagnostics
 * + the model-drift lookup the view renders; `dutiesForDisplay` de-dupes an
 * agent's duties by id (a declared duty and an embedded-routine of the same id
 * collapse to one, preferring the routine form).
 */

import { describe, expect, it } from "vitest";
import { buildAgentSystemVm, dutiesForDisplay, formatBudget } from "../../src/ui/agents/agent-system-view.js";
import { goldenAgentSystem, emptyAgentSystem } from "./fixtures/agents.js";

describe("buildAgentSystemVm", () => {
  it("orders the roster CEO -> COO -> CTO -> Librarian", () => {
    const vm = buildAgentSystemVm(goldenAgentSystem());
    expect(vm.agents.map((a) => a.displayName)).toEqual(["CEO", "COO", "CTO", "Librarian"]);
    expect(vm.hasAnyData).toBe(true);
  });

  it("sorts diagnostics warn-first and tallies the severities", () => {
    const vm = buildAgentSystemVm(goldenAgentSystem());
    expect(vm.diagnostics[0]?.severity).toBe("warn");
    expect(vm.diagnostics[0]?.code).toBe("handoff_mismatch");
    expect(vm.warnCount).toBe(1);
    expect(vm.infoCount).toBe(4);
  });

  it("collects the set of agents flagged for model drift", () => {
    const vm = buildAgentSystemVm(goldenAgentSystem());
    expect(vm.agentsWithModelDrift).toEqual(new Set(["ceo", "coo", "cto", "librarian"]));
  });

  it("counts inconsistent handoffs", () => {
    const vm = buildAgentSystemVm(goldenAgentSystem());
    expect(vm.handoffMismatchCount).toBe(1);
    expect(vm.overlaps).toHaveLength(1);
  });

  it("reports an all-clear zero-state for a company with no agents", () => {
    const vm = buildAgentSystemVm(emptyAgentSystem());
    expect(vm.agents).toEqual([]);
    expect(vm.hasAnyData).toBe(false);
    expect(vm.diagnostics).toEqual([]);
  });
});

describe("dutiesForDisplay", () => {
  it("de-dupes a duty whose id collides with an embedded routine, preferring the routine form", () => {
    const librarian = goldenAgentSystem().agents.find((a) => a.displayName === "Librarian");
    expect(librarian).toBeDefined();
    const duties = dutiesForDisplay(librarian!);
    const wiki = duties.filter((d) => d.id === "wiki-maintenance");
    expect(wiki).toHaveLength(1);
    expect(wiki[0]?.kind).toBe("embedded-routine");
  });
});

describe("formatBudget", () => {
  it("renders whole-dollar and fractional monthly budgets", () => {
    expect(formatBudget(17000)).toBe("$170/mo");
    expect(formatBudget(8000)).toBe("$80/mo");
    expect(formatBudget(2550)).toBe("$25.50/mo");
    expect(formatBudget(null)).toBe("—");
  });
});
