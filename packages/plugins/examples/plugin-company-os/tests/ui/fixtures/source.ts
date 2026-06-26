/**
 * Golden + empty `GitStateV1` fixtures for the Source SSR tests. Built against the
 * real `taxonomyFixture()` and validated through `parseGitStateV1` at construction
 * so a fixture can never drift from the contract. Exercises: project grouping, a
 * dependency repo, an absent repo (0-row), in-sync vs behind/conflicting branches,
 * a no-merge-base comparison, per-worktree dirty state, and recent commits.
 */

import { parseGitStateV1, type GitStateV1 } from "../../../src/contracts/index.js";
import { findProjectGroup } from "../../../src/contracts/projects.js";
import { taxonomyFixture } from "../../fixtures/taxonomy.js";

export const SOURCE_NOW = Date.parse("2026-06-26T18:00:00Z");

const TAX = taxonomyFixture();
const group = (key: string) => {
  const g = findProjectGroup(TAX, key);
  if (!g) throw new Error(`taxonomy fixture missing group ${key}`);
  return g;
};

const trunkOk = { ref: "origin/main", state: "ok" as const };

export function goldenGitState(): GitStateV1 {
  return parseGitStateV1({
    schemaVersion: 1,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: TAX,
    groups: [
      {
        group: group("company"),
        repos: [
          {
            repoKey: "company",
            role: "primary",
            availability: "ok",
            trunk: trunkOk,
            branches: [
              {
                branch: "main",
                headSha: "928bdb5f0e21aa",
                worktrees: [{ name: "company", headSha: "928bdb5f0e21aa", detached: false, dirtyFileCount: 0 }],
                trunk: trunkOk,
                comparison: "ok",
                ahead: 0,
                behind: 0,
                conflictsWithTrunk: false,
                lastCommitAt: "2026-06-26T15:10:00Z",
                staleDays: 0,
                statuses: [],
                recentCommits: [
                  { sha: "928bdb5f0e21aa", subject: "feat(COS-0): ship the company-os cockpit", author: "Joe", committedAt: "2026-06-26T15:10:00Z", stat: { filesChanged: 34, insertions: 2841, deletions: 12 } },
                ],
              },
              {
                branch: "docs/COS-1",
                headSha: "f96d4ce0aa11",
                worktrees: [{ name: "cos-COS-1", headSha: "f96d4ce0aa11", detached: false, dirtyFileCount: 3 }],
                trunk: trunkOk,
                comparison: "ok",
                ahead: 5,
                behind: 0,
                conflictsWithTrunk: false,
                lastCommitAt: "2026-06-26T16:50:00Z",
                staleDays: 0,
                statuses: ["dirty"],
                recentCommits: [
                  { sha: "f96d4ce0aa11", subject: "docs(COS-1): §16 reconciliation for COS-1e", author: "Joe", committedAt: "2026-06-26T16:50:00Z" },
                  { sha: "132cb1e45bb2", subject: "feat(COS-1e): polish passes — responsive rows", author: "Joe", committedAt: "2026-06-26T16:20:00Z", stat: { filesChanged: 4, insertions: 90, deletions: 40 } },
                ],
              },
            ],
          },
        ],
      },
      {
        group: group("juice-bar"),
        repos: [
          {
            repoKey: "juice-bar",
            role: "primary",
            availability: "ok",
            trunk: trunkOk,
            branches: [
              {
                branch: "claude/SSF-04/reconciliation-rehaul",
                headSha: "a34ad7d31cc0",
                worktrees: [{ name: "ssf-04", headSha: "a34ad7d31cc0", detached: false, dirtyFileCount: 7 }],
                trunk: trunkOk,
                comparison: "ok",
                ahead: 2,
                behind: 14,
                conflictsWithTrunk: true,
                lastCommitAt: "2026-06-23T16:00:00Z",
                staleDays: 3,
                statuses: ["conflicting", "behind", "dirty"],
                recentCommits: [
                  { sha: "a34ad7d31cc0", subject: "feat(SSF-04): forward-compat seam", author: "Joe", committedAt: "2026-06-23T16:00:00Z", stat: { filesChanged: 11, insertions: 230, deletions: 18 } },
                ],
              },
            ],
          },
          {
            repoKey: "arc-scraper",
            role: "dependency",
            availability: "ok",
            trunk: trunkOk,
            branches: [
              {
                branch: "mtpfeed-01a-arc",
                headSha: "b5863d4ff112",
                worktrees: [],
                trunk: trunkOk,
                comparison: "no_merge_base",
                ahead: null,
                behind: null,
                conflictsWithTrunk: null,
                lastCommitAt: "2026-06-11T12:00:00Z",
                staleDays: 15,
                statuses: ["comparison_unavailable", "stale"],
                recentCommits: [],
              },
            ],
          },
        ],
      },
      {
        group: group("viacava-arts"),
        repos: [
          { repoKey: "viacava-arts", role: "primary", availability: "missing", trunk: { ref: null, state: "missing" }, branches: [] },
        ],
      },
    ],
    sources: [
      { source: "branch", repo: "juice-bar", freshness: "live", lastOkAt: "2026-06-26T17:56:00Z", errorCount: 0, message: null },
      { source: "branch", repo: "viacava-arts", freshness: "stale", lastOkAt: null, errorCount: 1, message: "repo not found on disk" },
    ],
    diagnostics: [],
  });
}

/** Everything derived but no repos resolved — Source must render its calm 0-state. */
export function emptyGitState(): GitStateV1 {
  return parseGitStateV1({
    schemaVersion: 1,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: TAX,
    groups: [],
    sources: [],
    diagnostics: [],
  });
}
