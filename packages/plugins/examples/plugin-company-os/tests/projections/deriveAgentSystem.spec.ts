import { describe, expect, it } from "vitest";
import { parseAgentSystemV1 } from "../../src/contracts/agent-system.js";
import { deriveAgentSystem } from "../../src/projections/deriveAgentSystem.js";
import { NOW, agentSignal, artifact, bundleOf, routine } from "../fixtures/signals.js";

describe("deriveAgentSystem", () => {
  it("joins agents to owned routines and computes vitals", () => {
    const system = deriveAgentSystem(
      bundleOf([
        agentSignal("ceo", {
          displayName: "CEO",
          role: "ceo",
          budgetMonthlyCents: 3000,
          canCreateAgents: true,
          reportsTo: null,
          handsOffTo: ["CTO"],
          receivesFrom: ["CTO"],
          duties: [{ id: "strategy", surface: "company/reports/strategy" }],
        }),
        agentSignal("coo", {
          displayName: "COO",
          role: "pm",
          budgetMonthlyCents: 3000,
          reportsTo: "CEO",
          duties: [{ id: "health", surface: "company/reports/health" }],
        }),
        agentSignal("cto", {
          displayName: "CTO",
          role: "cto",
          budgetMonthlyCents: 8000,
          reportsTo: "CEO",
          handsOffTo: ["CEO"],
          receivesFrom: ["CEO"],
          duties: [{ id: "standup", surface: "company/reports/standup" }],
        }),
        agentSignal("librarian", {
          displayName: "Librarian",
          role: "librarian",
          budgetMonthlyCents: 3000,
          reportsTo: "CEO",
          maxTurnsPerRun: 500,
          duties: [{ id: "wiki-maintenance", surface: "company/library/topics" }],
        }),
        routine("weekly-strategic-summary", "weekly", "company/reports/strategy/*.md", {
          ownerAgent: "CEO",
          displayName: "Weekly Strategic Summary",
          freshnessKind: "artifact",
        }),
        routine("daily-health-scan", "daily", "company/reports/health/*.md", {
          ownerAgent: "COO",
          displayName: "Daily Health Scan",
          freshnessKind: "artifact",
          lastRunAt: "2026-06-23T11:00:00.000Z",
        }),
        routine("daily-standup", "daily", "company/reports/standup/*.md", {
          ownerAgent: "CTO",
          displayName: "Daily Standup",
          freshnessKind: "artifact",
        }),
        routine("wiki-maintenance", "daily scan", "", {
          ownerAgent: "Librarian",
          displayName: "Wiki Maintenance",
          freshnessKind: "embedded",
        }),
        artifact("reports/strategy/2026-06-23.md", {
          repo: "company",
          mtime: "2026-06-23T10:00:00.000Z",
          createdBy: "CEO",
        }),
        artifact("reports/standup/2026-06-22.md", {
          repo: "company",
          mtime: "2026-06-22T00:00:00.000Z",
          createdBy: "CTO",
        }),
      ]),
      NOW,
    );

    expect(system.agents.map((a) => a.displayName)).toEqual(["CEO", "COO", "CTO", "Librarian"]);
    expect(system.agents.map((a) => a.ownedRoutines.length)).toEqual([1, 1, 1, 1]);
    expect(system.agents.find((a) => a.displayName === "CEO")?.healthRollup).toBe("fresh");
    expect(system.agents.find((a) => a.displayName === "COO")?.healthRollup).toBe("missing");
    expect(system.agents.find((a) => a.displayName === "CTO")?.healthRollup).toBe("stale");
    expect(system.agents.find((a) => a.displayName === "Librarian")?.healthRollup).toBeNull();
    expect(system.agents.find((a) => a.displayName === "Librarian")?.duties).toContainEqual({
      id: "wiki-maintenance",
      label: "Wiki Maintenance",
      surface: null,
      kind: "embedded-routine",
    });
    expect(system.vitals).toMatchObject({
      agentCount: 4,
      routinesFreshPct: 33,
      verdictCounts: { fresh: 1, stale: 1, missing: 1, never_ran: 0 },
      budgetMonthlyCentsTotal: 17000,
      heartbeatCadence: "daily",
      diagnosticsCount: 0,
    });
    expect(() => parseAgentSystemV1(system)).not.toThrow();
  });

  it("derives overlaps by path containment and handoff mismatch diagnostics", () => {
    const system = deriveAgentSystem(
      bundleOf([
        agentSignal("coo", {
          displayName: "COO",
          duties: [{ id: "doc-currency", surface: "company/docs" }],
          handsOffTo: ["CTO"],
          receivesFrom: [],
        }),
        agentSignal("cto", {
          displayName: "CTO",
          duties: [{ id: "technical-docs", surface: "company/docs/reference" }],
          handsOffTo: [],
          receivesFrom: [],
        }),
      ]),
      NOW,
    );

    expect(system.overlaps).toContainEqual({
      surface: "company/docs",
      agents: ["COO", "CTO"],
      proposedOwner: "Librarian",
      recommendation: "Librarian owns content freshness and wiki updates; COO owns process trend reporting when freshness slips repeatedly.",
    });
    expect(system.handoffs).toContainEqual({ from: "COO", to: "CTO", consistent: false });
    expect(system.diagnostics).toContainEqual({
      code: "handoff_mismatch",
      severity: "warn",
      message: "COO hands off to CTO, but CTO does not list COO in receivesFrom.",
      agentKey: "coo",
    });
  });

  it("diagnoses unknown routine owners without creating a fifth agent", () => {
    const system = deriveAgentSystem(
      bundleOf([
        agentSignal("cto", { displayName: "CTO" }),
        routine("mystery", "daily", "company/reports/mystery/*.md", {
          ownerAgent: "Foo",
          displayName: "Mystery Routine",
          freshnessKind: "artifact",
        }),
      ]),
      NOW,
    );

    expect(system.agents.map((a) => a.displayName)).toEqual(["CTO"]);
    expect(system.diagnostics).toContainEqual({
      code: "unknown_owner_agent",
      severity: "warn",
      message: "Routine mystery declares unknown ownerAgent Foo.",
      agentKey: null,
    });
  });

  it("deduplicates duplicate company roots by owner agent", () => {
    const system = deriveAgentSystem(
      bundleOf([
        agentSignal("cto", {
          displayName: "CTO",
          repo: "company-copy",
          freshness: "cached",
          budgetMonthlyCents: 4000,
          duties: [{ id: "copied-docs", surface: "company/docs" }],
        }),
        agentSignal("cto", {
          displayName: "CTO",
          repo: "company",
          freshness: "live",
          budgetMonthlyCents: 8000,
          duties: [{ id: "technical-analysis", surface: "company/reports/analysis" }],
        }),
        routine("technical-analysis", "daily", "company/reports/analysis/*.md", {
          ownerAgent: "CTO",
          displayName: "Technical Analysis",
          freshnessKind: "artifact",
        }),
        routine("technical-analysis", "daily", "company-copy/reports/analysis/*.md", {
          repo: "company-copy",
          freshness: "cached",
          ownerAgent: "CTO",
          displayName: "Technical Analysis",
          freshnessKind: "artifact",
        }),
        artifact("reports/analysis/2026-06-23.md", {
          repo: "company",
          mtime: "2026-06-23T10:00:00.000Z",
          createdBy: "CTO",
        }),
      ]),
      NOW,
    );

    expect(system.agents).toHaveLength(1);
    expect(system.agents[0]).toMatchObject({
      displayName: "CTO",
      budgetMonthlyCents: 8000,
      duties: [{ id: "technical-analysis", surface: "company/reports/analysis", kind: "duty" }],
    });
    expect(system.agents[0]?.ownedRoutines).toHaveLength(1);
    expect(system.agents[0]?.ownedRoutines[0]).toMatchObject({
      routineKey: "technical-analysis",
      latestArtifactPath: "reports/analysis/2026-06-23.md",
      verdict: "fresh",
    });
    expect(system.vitals.agentCount).toBe(1);
    expect(system.vitals.verdictCounts).toEqual({ fresh: 1, stale: 0, missing: 0, never_ran: 0 });
    expect(system.vitals.budgetMonthlyCentsTotal).toBe(8000);
  });
});
