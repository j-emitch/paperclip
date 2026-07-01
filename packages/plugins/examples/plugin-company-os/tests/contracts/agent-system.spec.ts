import { describe, expect, it } from "vitest";
import {
  AGENT_SYSTEM_SCHEMA_VERSION,
  parseAgentSystemV1,
  safeParseAgentSystemV1,
  type AgentSystemV1,
} from "../../src/contracts/index.js";

describe("AgentSystemV1 contract", () => {
  it("round-trips a complete agent-system snapshot", () => {
    const parsed = parseAgentSystemV1(goldenAgentSystem());

    expect(parsed.schemaVersion).toBe(AGENT_SYSTEM_SCHEMA_VERSION);
    expect(parsed.vitals.agentCount).toBe(4);
    expect(parsed.agents.map((agent) => agent.displayName)).toEqual(["CEO", "COO", "CTO", "Librarian"]);
    expect(parsed.overlaps[0]?.proposedOwner).toBeNull();
    expect(parsed.handoffs[0]).toEqual({ from: "CEO", to: "CTO", consistent: true });
  });

  it("accepts nullable verdicts for embedded/duties-only routine cards", () => {
    const system = goldenAgentSystem();
    const embedded = system.agents[3]?.ownedRoutines[0];

    expect(embedded?.freshnessKind).toBe("embedded");
    expect(embedded?.verdict).toBeNull();
    expect(safeParseAgentSystemV1(system).success).toBe(true);
  });

  it("rejects malformed schema versions and unknown diagnostic codes", () => {
    expect(safeParseAgentSystemV1({ ...goldenAgentSystem(), schemaVersion: 2 }).success).toBe(false);

    const badDiagnostic = {
      ...goldenAgentSystem(),
      diagnostics: [
        {
          code: "surprise",
          severity: "warn",
          message: "unknown code must not drift into the persisted contract",
          agentKey: null,
        },
      ],
    };
    expect(safeParseAgentSystemV1(badDiagnostic).success).toBe(false);
  });

  it("rejects an overlap proposedOwner that is not an OwnerAgent (codex B)", () => {
    const foreignOwner = {
      ...goldenAgentSystem(),
      overlaps: [{ surface: "company/reports/journal", agents: ["CTO", "Librarian"], proposedOwner: "Marketing", recommendation: null }],
    };
    expect(safeParseAgentSystemV1(foreignOwner).success).toBe(false);
    // A real OwnerAgent still parses.
    const realOwner = {
      ...goldenAgentSystem(),
      overlaps: [{ surface: "company/reports/journal", agents: ["CTO", "Librarian"], proposedOwner: "Librarian", recommendation: null }],
    };
    expect(safeParseAgentSystemV1(realOwner).success).toBe(true);
  });
});

function goldenAgentSystem(): AgentSystemV1 {
  return {
    schemaVersion: AGENT_SYSTEM_SCHEMA_VERSION,
    derivedAt: "2026-07-01T12:00:00.000Z",
    vitals: {
      agentCount: 4,
      routinesFreshPct: 50,
      verdictCounts: { fresh: 1, stale: 1, missing: 0, never_ran: 0 },
      budgetMonthlyCentsTotal: 8000,
      heartbeatCadence: "daily",
      diagnosticsCount: 1,
    },
    agents: [
      agent("ceo", "CEO", {
        role: "ceo",
        reportsTo: null,
        budgetMonthlyCents: 3000,
        canCreateAgents: true,
        handsOffTo: ["CTO"],
        ownedRoutines: [routine("weekly-strategic-summary", "CEO", "artifact", "fresh")],
      }),
      agent("coo", "COO", {
        role: "pm",
        reportsTo: "CEO",
        budgetMonthlyCents: 1500,
        ownedRoutines: [routine("daily-health-scan", "COO", "artifact", "stale")],
      }),
      agent("cto", "CTO", {
        role: "cto",
        reportsTo: "CEO",
        budgetMonthlyCents: 2000,
        receivesFrom: ["CEO"],
      }),
      agent("librarian", "Librarian", {
        role: "researcher",
        reportsTo: "CEO",
        budgetMonthlyCents: 1500,
        ownedRoutines: [routine("wiki-maintenance", "Librarian", "embedded", null)],
      }),
    ],
    overlaps: [
      {
        surface: "company/reports/journal",
        agents: ["CTO", "Librarian"],
        proposedOwner: null,
        recommendation: null,
      },
    ],
    handoffs: [{ from: "CEO", to: "CTO", consistent: true }],
    sources: [
      {
        source: "agent",
        repo: "company",
        freshness: "live",
        lastOkAt: "2026-07-01T12:00:00.000Z",
        errorCount: 0,
        message: null,
      },
    ],
    diagnostics: [
      {
        code: "model_drift",
        severity: "info",
        message: "Live Paperclip model may differ from git config.",
        agentKey: "ceo",
      },
    ],
  };
}

function agent(
  agentKey: string,
  displayName: "CEO" | "COO" | "CTO" | "Librarian",
  over: Partial<AgentSystemV1["agents"][number]> = {},
): AgentSystemV1["agents"][number] {
  return {
    agentKey,
    displayName,
    role: over.role ?? agentKey,
    model: over.model ?? "gpt-5.5",
    reportsTo: over.reportsTo ?? "CEO",
    budgetMonthlyCents: over.budgetMonthlyCents ?? null,
    canCreateAgents: over.canCreateAgents ?? false,
    maxTurnsPerRun: over.maxTurnsPerRun ?? 100,
    heartbeatIntervalSec: over.heartbeatIntervalSec ?? 86_400,
    summary: over.summary ?? null,
    duties: over.duties ?? [{ id: `${agentKey}-duties`, label: `${displayName} Duties`, surface: null, kind: "duty" }],
    ownedRoutines: over.ownedRoutines ?? [],
    healthRollup: over.healthRollup ?? null,
    handsOffTo: over.handsOffTo ?? [],
    receivesFrom: over.receivesFrom ?? [],
    ...over,
  };
}

function routine(
  routineKey: string,
  ownerAgent: "CEO" | "COO" | "CTO" | "Librarian",
  freshnessKind: "artifact" | "proposal" | "embedded",
  verdict: "fresh" | "stale" | "missing" | "never_ran" | null,
): AgentSystemV1["agents"][number]["ownedRoutines"][number] {
  return {
    routineKey,
    displayName: routineKey,
    ownerAgent,
    cadence: "daily",
    expectedArtifactGlob: freshnessKind === "embedded" ? "" : "company/reports/**/*.md",
    freshnessKind,
    lastRunAt: null,
    nextExpectedAt: null,
    expectedArtifactPresent: verdict === "fresh",
    latestArtifactPath: null,
    latestArtifactMtime: null,
    verdict,
    detail: null,
  };
}
