import { describe, expect, it } from "vitest";
import { routineContractSource, normalizeArtifactGlob } from "../../src/sources/RoutineContractSource.js";
import { isRoutineSignal } from "../../src/contracts/signals.js";
import { matchesAnyGlob } from "../../src/sources/glob.js";
import { makeFixtureContext } from "../fixtures/context.js";

const CTO_SIDECAR = JSON.stringify({
  agent: {
    name: "CTO",
    reports_to: "ceo",
    summary: "Technical analysis, ticket shaping, and architecture guidance.",
    duties: [],
    hands_off_to: ["coo", "librarian", "ceo"],
    receives_from: ["ceo", "coo", "librarian"],
  },
  routines: [
    {
      id: "daily-standup",
      display_name: "Daily Standup",
      cadence: "daily",
      owner_agent: "CTO",
      freshness: {
        kind: "artifact",
        expected_artifact: "company/reports/standup/*.md",
        exclude: [],
      },
    },
    {
      id: "weekly-report",
      display_name: "Weekly Report",
      cadence: "weekly",
      owner_agent: "CTO",
      freshness: {
        kind: "artifact",
        expected_artifact: "company/reports/weekly/*.md",
        exclude: [],
      },
    },
  ],
});

const LIBRARIAN_SIDECAR = JSON.stringify({
  agent: {
    name: "Librarian",
    reports_to: "ceo",
    summary: "Knowledge stewardship.",
    duties: [],
    hands_off_to: ["ceo", "cto", "coo"],
    receives_from: ["ceo", "cto", "coo"],
  },
  routines: [
    {
      id: "daily-codebase-awareness",
      display_name: "Daily Codebase Awareness",
      cadence: "daily",
      owner_agent: "Librarian",
      freshness: {
        kind: "artifact",
        expected_artifact: "company/reports/journal/*-codebase-awareness*.md",
        exclude: [
          "company/reports/journal/*-knowledge-audit*.md",
          "company/reports/journal/*-session-summary*.md",
        ],
      },
    },
    {
      id: "R9f-context-rollup-stewardship",
      display_name: "R9f Context Rollup Stewardship",
      cadence: "on R9 audit",
      owner_agent: "Librarian",
      freshness: {
        kind: "proposal",
        proposal_source: "company/reports/paperclip/tickets/LYC-*.md",
      },
    },
    {
      id: "wiki-maintenance",
      display_name: "Wiki Maintenance",
      cadence: "daily scan",
      owner_agent: "Librarian",
      freshness: { kind: "embedded" },
    },
  ],
});

describe("RoutineContractSource", () => {
  it("emits a RoutineSignal per routine from the company-os sidecar", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/paperclip/agents/cto/company-os.json": { content: CTO_SIDECAR } } },
    });
    const routines = (await routineContractSource.collect(ctx)).signals.filter(isRoutineSignal);
    expect(routines.map((r) => r.routineKey)).toEqual(["daily-standup", "weekly-report"]);
    expect(routines[0]).toMatchObject({
      displayName: "Daily Standup",
      ownerAgent: "CTO",
      cadence: "daily",
      // The single-`*` sidecar glob is normalized to a recursive match so bucketed outputs still join (P1-2).
      expectedArtifactGlob: "company/reports/standup/**/*.md",
      freshnessKind: "artifact",
      exclude: [],
      path: "config/paperclip/agents/cto/company-os.json",
    });
  });

  it("normalizes a single-segment expected_artifact glob to a recursive match (P1-2)", () => {
    expect(normalizeArtifactGlob("company/reports/strategy/*.md")).toBe("company/reports/strategy/**/*.md");
    expect(normalizeArtifactGlob("company/reports/health/*")).toBe("company/reports/health/**/*");
    expect(normalizeArtifactGlob("company/reports/journal/*-knowledge-audit*.md")).toBe(
      "company/reports/journal/**/*-knowledge-audit*.md",
    );
    // Already-recursive globs are left untouched (no double **).
    expect(normalizeArtifactGlob("company/reports/x/**/*.md")).toBe("company/reports/x/**/*.md");
    // The normalized glob matches BOTH a flat file and a date-bucketed one.
    const g = normalizeArtifactGlob("company/reports/strategy/*.md");
    expect(matchesAnyGlob("company/reports/strategy/2026-06-23.md", [g])).toBe(true);
    expect(matchesAnyGlob("company/reports/strategy/2026/06-23.md", [g])).toBe(true);
    // ...but does not leak outside the dir.
    expect(matchesAnyGlob("company/reports/other/x.md", [g])).toBe(false);
  });

  it("carries proposal, embedded, and per-routine artifact exclude metadata", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/paperclip/agents/librarian/company-os.json": { content: LIBRARIAN_SIDECAR },
        },
      },
    });
    const routines = (await routineContractSource.collect(ctx)).signals.filter(isRoutineSignal);
    const daily = routines.find((r) => r.routineKey === "daily-codebase-awareness");
    const proposal = routines.find((r) => r.routineKey === "R9f-context-rollup-stewardship");
    const embedded = routines.find((r) => r.routineKey === "wiki-maintenance");

    expect(daily).toMatchObject({
      freshnessKind: "artifact",
      expectedArtifactGlob: "company/reports/journal/**/*-codebase-awareness*.md",
      exclude: [
        "company/reports/journal/**/*-knowledge-audit*.md",
        "company/reports/journal/**/*-session-summary*.md",
      ],
    });
    expect(proposal).toMatchObject({
      freshnessKind: "proposal",
      expectedArtifactGlob: "company/reports/paperclip/tickets/LYC-*.md",
      proposalSource: "company/reports/paperclip/tickets/LYC-*.md",
    });
    expect(embedded).toMatchObject({
      freshnessKind: "embedded",
      expectedArtifactGlob: "",
    });
  });

  it("an AGENTS file without a sidecar contributes nothing (not an error)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/paperclip/agents/coo/AGENTS.md": { content: "# COO\n\nNo block here." } } },
    });
    const batch = await routineContractSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].errors).toEqual([]);
  });

  it("falls back to legacy AGENTS company_os blocks when sidecars are not installed yet", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/paperclip/agents/cto/AGENTS.md": {
            content: [
              "# CTO",
              "",
              "```yaml",
              "company_os:",
              "  routines:",
              "    - id: daily-standup",
              "      display_name: Daily Standup",
              "      cadence: daily",
              "      expected_artifact: company/reports/standup/*.md",
              "      owner_agent: CTO",
              "```",
            ].join("\n"),
          },
        },
      },
    });

    const routines = (await routineContractSource.collect(ctx)).signals.filter(isRoutineSignal);

    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({
      routineKey: "daily-standup",
      path: "config/paperclip/agents/cto/AGENTS.md",
      expectedArtifactGlob: "company/reports/standup/**/*.md",
      freshnessKind: "artifact",
    });
  });
});
