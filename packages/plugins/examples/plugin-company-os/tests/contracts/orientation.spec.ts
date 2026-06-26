import { describe, expect, it } from "vitest";
import {
  DEFAULT_PINNED_ROLES,
  HOME_RECENT_COMMITS_LIMIT,
  orientationV1Schema,
  parseOrientationV1,
  safeParseOrientationV1,
} from "../../src/contracts/index.js";

const TAXONOMY = { schemaVersion: 1 as const, groups: [], source: "derived-default" as const, diagnostics: [] };

const MINIMAL = {
  schemaVersion: 1 as const,
  derivedAt: "2026-06-23T00:00:00.000Z",
  taxonomy: TAXONOMY,
  briefing: [],
  metrics: { openPrs: 0, inProgress: 0, alerts: 0, branchesNeedingAttention: 0, dirtyWorktrees: 0 },
  branchHealth: [],
  recentCommits: [],
  recentWork: [],
  alerts: [],
  sources: [],
  diagnostics: [],
};

describe("OrientationV1", () => {
  it("a minimal payload round-trips through parse", () => {
    const parsed = parseOrientationV1(MINIMAL);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.metrics.openPrs).toBe(0);
  });

  it("a populated payload (briefing + branch-health + typed deep-links) round-trips", () => {
    const populated = {
      ...MINIMAL,
      briefing: [
        {
          routineKey: "daily-standup",
          displayName: "Daily Standup",
          ownerAgent: "COO",
          verdict: "fresh",
          reportDate: "2026-06-23",
          repo: "company",
          relPath: "reports/standup/2026-06-23.md",
        },
      ],
      branchHealth: [
        {
          projectKey: "juice-bar",
          repo: "juice-bar",
          branch: "cos/COS-1",
          statuses: ["behind", "stale"],
          severity: "medium",
          behind: 7,
          staleDays: 20,
          deepLink: { tab: "source", repoKey: "juice-bar", branch: "cos/COS-1" },
        },
      ],
      recentCommits: [
        { projectKey: "company", repo: "company", branch: "lycaon", sha: "abc1234", subject: "feat", committedAt: "2026-06-23T01:00:00.000Z" },
      ],
      recentWork: [
        {
          projectKey: "juice-bar",
          system: "Onboarding",
          kind: "spec",
          title: "OB-01",
          status: "shipped",
          updatedAt: "2026-06-23T01:00:00.000Z",
          deepLink: { tab: "docs", docId: "doc:abc" },
        },
      ],
      alerts: [
        {
          id: "a1",
          projectKey: "juice-bar",
          kind: "branch_at_risk",
          severity: "high",
          title: "conflict",
          detail: "branch conflicts with trunk",
          deepLink: { tab: "board", workId: "COS-1" },
        },
      ],
    };
    const parsed = parseOrientationV1(populated);
    expect(parsed.briefing[0]!.verdict).toBe("fresh");
    expect(parsed.branchHealth[0]!.deepLink.tab).toBe("source");
    expect(parsed.alerts[0]!.deepLink.tab).toBe("board");
  });

  it("rejects a malformed deep-link tab", () => {
    const bad = {
      ...MINIMAL,
      alerts: [
        { id: "a1", projectKey: "x", kind: "branch_at_risk", severity: "high", title: "t", detail: "d", deepLink: { tab: "bogus" } },
      ],
    };
    expect(safeParseOrientationV1(bad).success).toBe(false);
  });

  it("rejects a wrong schemaVersion (forces re-derive on read)", () => {
    expect(orientationV1Schema.safeParse({ ...MINIMAL, schemaVersion: 2 }).success).toBe(false);
  });

  it("exposes the stable default-pinned-role contract", () => {
    expect([...DEFAULT_PINNED_ROLES]).toEqual([
      "daily-standup",
      "codebase-health",
      "strategy",
      "weekly-summary",
      "process-audit",
    ]);
    expect(HOME_RECENT_COMMITS_LIMIT).toBe(20);
  });
});
