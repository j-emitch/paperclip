import { describe, expect, it } from "vitest";
import {
  BEHIND_WARN,
  MAX_CONFLICT_CHECKS,
  STALE_WARN,
  gitStateV1Schema,
  parseGitStateV1,
  safeParseGitStateV1,
} from "../../src/contracts/index.js";

const TAXONOMY = { schemaVersion: 1 as const, groups: [], source: "derived-default" as const, diagnostics: [] };

const MINIMAL = {
  schemaVersion: 1 as const,
  derivedAt: "2026-06-23T00:00:00.000Z",
  taxonomy: TAXONOMY,
  groups: [],
  sources: [],
  diagnostics: [],
};

const GROUP = { key: "juice-bar", displayName: "Juice Bar", kind: "product" as const, repos: [{ repoKey: "juice-bar", role: "primary" as const }], order: 1 };

describe("GitStateV1", () => {
  it("a minimal payload round-trips through parse", () => {
    const parsed = parseGitStateV1(MINIMAL);
    expect(parsed.groups).toEqual([]);
  });

  it("a populated project section (branches + worktrees + commits) round-trips", () => {
    const populated = {
      ...MINIMAL,
      groups: [
        {
          group: GROUP,
          displayPrimaryRepoKey: "arc-scraper",
          repos: [
            {
              repoKey: "juice-bar",
              role: "primary",
              availability: "ok",
              trunk: { ref: "origin/main", state: "ok" },
              branches: [
                {
                  branch: "cos/COS-1",
                  headSha: "abc1234",
                  worktrees: [{ path: "/p/wt", headSha: "abc1234", detached: false, dirtyFileCount: 3 }],
                  trunk: { ref: "origin/main", state: "ok" },
                  comparison: "ok",
                  ahead: 2,
                  behind: 7,
                  conflictsWithTrunk: false,
                  lastCommitAt: "2026-06-23T01:00:00.000Z",
                  staleDays: 20,
                  recentCommits: [
                    {
                      sha: "abc1234",
                      subject: "feat",
                      author: "Joe",
                      committedAt: "2026-06-23T01:00:00.000Z",
                      stat: { filesChanged: 3, insertions: 40, deletions: 5 },
                    },
                  ],
                  statuses: ["behind", "stale", "dirty"],
                },
              ],
            },
            {
              repoKey: "arc-scraper",
              role: "dependency",
              availability: "missing",
              trunk: { ref: null, state: "missing" },
              branches: [],
            },
          ],
        },
      ],
    };
    const parsed = parseGitStateV1(populated);
    expect(parsed.groups[0]!.displayPrimaryRepoKey).toBe("arc-scraper");
    expect(parsed.groups[0]!.repos[0]!.branches[0]!.statuses).toContain("dirty");
    expect(parsed.groups[0]!.repos[1]!.availability).toBe("missing");
    expect(parsed.groups[0]!.repos[1]!.branches).toEqual([]);
  });

  it("rejects a malformed availability", () => {
    const bad = {
      ...MINIMAL,
      groups: [{ group: GROUP, repos: [{ repoKey: "x", role: "primary", availability: "bogus", trunk: { ref: null, state: "missing" }, branches: [] }] }],
    };
    expect(safeParseGitStateV1(bad).success).toBe(false);
  });

  it("rejects a malformed branch status", () => {
    const bad = {
      ...MINIMAL,
      groups: [
        {
          group: GROUP,
          repos: [
            {
              repoKey: "x",
              role: "primary",
              availability: "ok",
              trunk: { ref: "origin/main", state: "ok" },
              branches: [
                { branch: "m", headSha: "a", worktrees: [], trunk: { ref: "origin/main", state: "ok" }, comparison: "ok", ahead: 0, behind: 0, conflictsWithTrunk: null, lastCommitAt: "2026-06-23T01:00:00.000Z", staleDays: 0, recentCommits: [], statuses: ["not_a_status"] },
              ],
            },
          ],
        },
      ],
    };
    expect(safeParseGitStateV1(bad).success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    expect(gitStateV1Schema.safeParse({ ...MINIMAL, schemaVersion: 2 }).success).toBe(false);
  });

  it("exposes the §7 threshold + cost-cap constants", () => {
    expect(BEHIND_WARN).toBe(6);
    expect(STALE_WARN).toBe(14);
    expect(MAX_CONFLICT_CHECKS).toBe(12);
  });
});
