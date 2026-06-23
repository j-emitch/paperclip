import { describe, expect, it } from "vitest";
import { routineContractSource } from "../../src/sources/RoutineContractSource.js";
import { isRoutineSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

const CTO_AGENTS = `# CTO Directive

Some prose.

\`\`\`yaml
company_os:
  routines:
    - id: daily-standup
      display_name: Daily Standup
      cadence: daily
      expected_artifact: company/reports/standup/*.md
      owner_agent: CTO
    - id: weekly-report
      display_name: Weekly Report
      cadence: weekly
      expected_artifact: company/reports/weekly/*.md
      owner_agent: CTO
\`\`\`
`;

const CEO_WITH_WA = `# CEO

\`\`\`yaml
company_os:
  write_authority:
    tier: 1
    surfaces:
      - backlog-archival
  routines:
    - id: weekly-strategic-summary
      display_name: Weekly Strategic Summary (Friday)
      cadence: weekly
      expected_artifact: company/reports/exec/*.md
      owner_agent: CEO
\`\`\`
`;

describe("RoutineContractSource", () => {
  it("emits a RoutineSignal per routine from the company_os block", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/paperclip/agents/cto/AGENTS.md": { content: CTO_AGENTS } } },
    });
    const routines = (await routineContractSource.collect(ctx)).signals.filter(isRoutineSignal);
    expect(routines.map((r) => r.routineKey)).toEqual(["daily-standup", "weekly-report"]);
    expect(routines[0]).toMatchObject({
      displayName: "Daily Standup",
      ownerAgent: "CTO",
      cadence: "daily",
      expectedArtifactGlob: "company/reports/standup/*.md",
      path: "config/paperclip/agents/cto/AGENTS.md",
    });
  });

  it("tolerates an optional write_authority key without affecting routine parsing", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/paperclip/agents/ceo/AGENTS.md": { content: CEO_WITH_WA } } },
    });
    const routines = (await routineContractSource.collect(ctx)).signals.filter(isRoutineSignal);
    expect(routines).toHaveLength(1);
    expect(routines[0].ownerAgent).toBe("CEO");
  });

  it("an AGENTS file without a company_os block contributes nothing (not an error)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/paperclip/agents/coo/AGENTS.md": { content: "# COO\n\nNo block here." } } },
    });
    const batch = await routineContractSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].errors).toEqual([]);
  });
});
