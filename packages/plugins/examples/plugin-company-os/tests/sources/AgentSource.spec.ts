import { describe, expect, it } from "vitest";
import { isAgentSignal } from "../../src/contracts/signals.js";
import { agentSource } from "../../src/sources/AgentSource.js";
import { makeFixtureContext } from "../fixtures/context.js";

const PAPERCLIP_YAML = `schema: "paperclip/v1"
agents:
  ceo:
    role: "ceo"
    capabilities: "Strategic intelligence, growth thinking, business coordination."
    adapter:
      config:
        dangerouslySkipPermissions: true
        model: "claude-opus-4-8"
      type: "claude_local"
    runtime:
      heartbeat:
        enabled: true
        intervalSec: 86400
        maxConcurrentRuns: 1
    permissions:
      canCreateAgents: true
    budgetMonthlyCents: 3000
  coo:
    role: "pm"
    capabilities: "Health monitoring and process enforcement."
    adapter:
      config:
        model: "claude-opus-4-8"
        dangerouslySkipPermissions: true
      type: "claude_local"
    runtime:
      heartbeat:
        enabled: true
        intervalSec: 86400
        maxConcurrentRuns: 1
    budgetMonthlyCents: 3000
  cto:
    role: "cto"
    capabilities: "Technical analysis and architecture guidance."
    adapter:
      config:
        dangerouslySkipPermissions: true
        model: "claude-opus-4-8"
      type: "claude_local"
    runtime:
      heartbeat:
        enabled: true
        intervalSec: 86400
        maxConcurrentRuns: 1
    budgetMonthlyCents: 8000
  librarian:
    role: "librarian"
    capabilities: "Knowledge stewardship and freshness enforcement."
    adapter:
      config:
        dangerouslySkipPermissions: true
        maxTurnsPerRun: 500
        model: "claude-opus-4-8"
      type: "claude_local"
    runtime:
      heartbeat:
        enabled: true
        intervalSec: 86400
        maxConcurrentRuns: 1
    budgetMonthlyCents: 3000
projects:
  company-os:
    status: "in_progress"
`;

const INVALID_NUMERIC_YAML = `schema: "paperclip/v1"
agents:
  cto:
    role: "cto"
    capabilities: "Technical analysis."
    adapter:
      config:
        model: "claude-opus-4-8"
        maxTurnsPerRun: 0
    runtime:
      heartbeat:
        intervalSec: -5
    budgetMonthlyCents: -1
`;

const BLANK_STRING_YAML = `schema: "paperclip/v1"
agents:
  cto:
    role: ""
    capabilities: "Technical analysis."
    adapter:
      config:
        model: "   "
`;

const CEO_SIDECAR = JSON.stringify({
  agent: {
    name: "CEO",
    reports_to: null,
    summary: "Strategic synthesis, growth thinking, and agent-system value audit.",
    duties: [{ id: "strategic-synthesis", surface: "company/reports/strategy" }],
    hands_off_to: ["cto", "coo", "librarian"],
    receives_from: ["cto", "coo", "librarian"],
  },
  routines: [],
});

const COO_SIDECAR = JSON.stringify({
  agent: {
    name: "COO",
    reports_to: "ceo",
    summary: "Operational health, process discipline, and recurring system hygiene.",
    duties: [
      { id: "operational-health", surface: "company/reports/health" },
      { id: "process-enforcement", surface: "company/reports/process" },
    ],
    hands_off_to: ["cto", "librarian"],
    receives_from: ["ceo", "cto", "librarian"],
  },
  routines: [],
});

const CTO_SIDECAR = JSON.stringify({
  agent: {
    name: "CTO",
    reports_to: "ceo",
    summary: "Technical analysis, ticket shaping, and architecture guidance.",
    duties: [
      { id: "daily-engineering-pulse", surface: "company/reports/standup" },
      { id: "technical-analysis", surface: "company/reports/analysis" },
    ],
    hands_off_to: ["coo", "librarian", "ceo"],
    receives_from: ["ceo", "coo", "librarian"],
  },
  routines: [],
});

const LIBRARIAN_SIDECAR = JSON.stringify({
  agent: {
    name: "Librarian",
    reports_to: "ceo",
    summary: "Knowledge stewardship, daily codebase awareness, and teachings synthesis.",
    duties: [
      { id: "daily-codebase-awareness", surface: "company/reports/journal" },
      { id: "wiki-maintenance", surface: "company/library/topics" },
    ],
    hands_off_to: ["ceo", "cto", "coo"],
    receives_from: ["ceo", "cto", "coo"],
  },
  routines: [],
});

function ctxWithSidecars(sidecars: Record<string, string>) {
  const files: Record<string, { content: string }> = {
    "config/paperclip/.paperclip.yaml": { content: PAPERCLIP_YAML },
  };
  for (const [slug, content] of Object.entries(sidecars)) {
    files[`config/paperclip/agents/${slug}/company-os.json`] = { content };
  }
  return makeFixtureContext({
    repos: [{ repo: "company", available: true }],
    files: { company: files },
  });
}

describe("AgentSource", () => {
  it("emits configured agents with sidecar coordination metadata", async () => {
    const ctx = ctxWithSidecars({
      ceo: CEO_SIDECAR,
      coo: COO_SIDECAR,
      cto: CTO_SIDECAR,
      librarian: LIBRARIAN_SIDECAR,
    });

    const batch = await agentSource.collect(ctx);
    const agents = batch.signals.filter(isAgentSignal);

    expect(agents.map((a) => a.agentKey)).toEqual(["ceo", "coo", "cto", "librarian"]);
    expect(agents.map((a) => a.displayName)).toEqual(["CEO", "COO", "CTO", "Librarian"]);
    expect(batch.repoFreshness[0]).toMatchObject({ repo: "company", freshness: "live", errors: [] });

    const ceo = agents.find((a) => a.agentKey === "ceo");
    expect(ceo).toMatchObject({
      displayName: "CEO",
      role: "ceo",
      model: "claude-opus-4-8",
      canCreateAgents: true,
      heartbeatIntervalSec: 86400,
      budgetMonthlyCents: 3000,
      reportsTo: null,
      handsOffTo: ["CTO", "COO", "Librarian"],
      receivesFrom: ["CTO", "COO", "Librarian"],
    });

    const coo = agents.find((a) => a.agentKey === "coo");
    expect(coo).toMatchObject({
      displayName: "COO",
      role: "pm",
      reportsTo: "CEO",
      canCreateAgents: false,
      maxTurnsPerRun: null,
      summary: "Operational health, process discipline, and recurring system hygiene.",
      duties: [
        { id: "operational-health", surface: "company/reports/health" },
        { id: "process-enforcement", surface: "company/reports/process" },
      ],
    });

    const librarian = agents.find((a) => a.agentKey === "librarian");
    expect(librarian).toMatchObject({
      model: "claude-opus-4-8",
      maxTurnsPerRun: 500,
      heartbeatIntervalSec: 86400,
      receivesFrom: ["CEO", "CTO", "COO"],
    });
  });

  it("degrades to identity-only when a sidecar is missing", async () => {
    const ctx = ctxWithSidecars({
      ceo: CEO_SIDECAR,
      coo: COO_SIDECAR,
      librarian: LIBRARIAN_SIDECAR,
    });

    const batch = await agentSource.collect(ctx);
    const cto = batch.signals.filter(isAgentSignal).find((a) => a.agentKey === "cto");

    expect(cto).toMatchObject({
      displayName: "CTO",
      role: "cto",
      model: "claude-opus-4-8",
      budgetMonthlyCents: 8000,
      summary: "Technical analysis and architecture guidance.",
      duties: [],
      reportsTo: null,
      handsOffTo: [],
      receivesFrom: [],
      freshness: "stale",
    });
    expect(cto?.errors).toEqual([
      {
        code: "not_found",
        message: "missing sidecar: config/paperclip/agents/cto/company-os.json",
        degraded: true,
      },
    ]);
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
    expect(batch.repoFreshness[0]?.errors.map((e) => e.code)).toContain("not_found");
  });

  it("keeps valid agent metadata when routine-only sidecar fields are malformed", async () => {
    const malformedRoutineSidecar = JSON.stringify({
      agent: {
        name: "CTO",
        reports_to: "ceo",
        summary: "Technical analysis.",
        duties: [{ id: "technical-analysis", surface: "company/reports/analysis" }],
        hands_off_to: ["ceo"],
        receives_from: ["ceo"],
      },
      routines: [
        {
          id: "bad-routine",
          display_name: "Bad Routine",
          cadence: "daily",
          owner_agent: "CTO",
          freshness: { kind: "artifact" },
        },
      ],
    });
    const ctx = ctxWithSidecars({ cto: malformedRoutineSidecar });

    const batch = await agentSource.collect(ctx);
    const cto = batch.signals.filter(isAgentSignal).find((a) => a.agentKey === "cto");

    expect(cto).toMatchObject({
      reportsTo: "CEO",
      summary: "Technical analysis.",
      duties: [{ id: "technical-analysis", surface: "company/reports/analysis" }],
      handsOffTo: ["CEO"],
      receivesFrom: ["CEO"],
      freshness: "stale",
    });
    expect(cto?.errors.map((e) => e.code)).toContain("parse_error");
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
  });

  it("filters blank sidecar coordination refs and records parse diagnostics", async () => {
    const sidecar = JSON.stringify({
      agent: {
        name: "CTO",
        reports_to: "ceo",
        summary: "Technical analysis.",
        duties: [{ id: "technical-analysis", surface: "company/reports/analysis" }],
        hands_off_to: ["coo", "", "  ", " librarian "],
        receives_from: ["ceo", "", " cto "],
      },
      routines: [],
    });
    const ctx = ctxWithSidecars({ cto: sidecar });

    const batch = await agentSource.collect(ctx);
    const cto = batch.signals.filter(isAgentSignal).find((a) => a.agentKey === "cto");

    expect(cto).toMatchObject({
      reportsTo: "CEO",
      handsOffTo: ["COO", "Librarian"],
      receivesFrom: ["CEO", "CTO"],
      freshness: "stale",
    });
    expect(cto?.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "config/paperclip/agents/cto/company-os.json: agent.hands_off_to[1] must be non-empty",
        "config/paperclip/agents/cto/company-os.json: agent.hands_off_to[2] must be non-empty",
        "config/paperclip/agents/cto/company-os.json: agent.receives_from[1] must be non-empty",
      ]),
    );
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
  });

  it("nulls invalid numeric agent config and records parse diagnostics", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/paperclip/.paperclip.yaml": { content: INVALID_NUMERIC_YAML },
          "config/paperclip/agents/cto/company-os.json": { content: CTO_SIDECAR },
        },
      },
    });

    const batch = await agentSource.collect(ctx);
    const cto = batch.signals.filter(isAgentSignal).find((a) => a.agentKey === "cto");

    expect(cto).toMatchObject({
      budgetMonthlyCents: null,
      maxTurnsPerRun: null,
      heartbeatIntervalSec: null,
      freshness: "stale",
    });
    expect(batch.repoFreshness[0]?.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "config/paperclip/.paperclip.yaml: agent cto adapter.config.maxTurnsPerRun must be positive",
        "config/paperclip/.paperclip.yaml: agent cto runtime.heartbeat.intervalSec must be positive",
        "config/paperclip/.paperclip.yaml: agent cto budgetMonthlyCents must be non-negative",
      ]),
    );
  });

  it("falls back for blank required string config and records parse diagnostics", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/paperclip/.paperclip.yaml": { content: BLANK_STRING_YAML },
          "config/paperclip/agents/cto/company-os.json": { content: CTO_SIDECAR },
        },
      },
    });

    const batch = await agentSource.collect(ctx);
    const cto = batch.signals.filter(isAgentSignal).find((a) => a.agentKey === "cto");

    expect(cto).toMatchObject({
      role: "cto",
      model: "unknown",
      freshness: "stale",
    });
    expect(batch.repoFreshness[0]?.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        "config/paperclip/.paperclip.yaml: agent cto role must be non-empty",
        "config/paperclip/.paperclip.yaml: agent cto adapter.config.model must be non-empty",
      ]),
    );
  });
});
