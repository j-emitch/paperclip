/**
 * Golden + empty `GitStateV1` fixtures for the Branch · PR Health SSR tests (COS-5e).
 * Built against the real `taxonomyFixture()` and validated through `parseGitStateV1`
 * at construction so a fixture can never drift from the contract. Exercises: project
 * grouping, a dependency repo, an absent repo (0-row), in-sync vs behind/conflicting
 * branches, a no-merge-base comparison, per-worktree dirty state, recent commits, AND
 * the COS-5e enrichment — an open PR with a head-current ship review, a DRAFT PR with
 * a blocking (no-ship) review + p0/p1 counts (attention band + flagged-review axis), a
 * PR whose local branch tip is ahead of the pushed PR head, and an orphan PR (no local
 * branch).
 */

import { parseGitStateV1, type GitStateV1 } from "../../../src/contracts/index.js";
import { findProjectGroup } from "../../../src/contracts/projects.js";
import { taxonomyFixture } from "../../fixtures/taxonomy.js";

export const BRANCH_PR_NOW = Date.parse("2026-06-26T18:00:00Z");

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
                attentionSeverity: "info",
                recentCommits: [
                  { sha: "928bdb5f0e21aa", subject: "feat(COS-0): ship the company-os cockpit", author: "Joe", committedAt: "2026-06-26T15:10:00Z", stat: { filesChanged: 34, insertions: 2841, deletions: 12 } },
                ],
                pullRequests: [],
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
                attentionSeverity: "medium",
                recentCommits: [
                  { sha: "f96d4ce0aa11", subject: "docs(COS-1): §16 reconciliation for COS-1e", author: "Joe", committedAt: "2026-06-26T16:50:00Z" },
                  { sha: "132cb1e45bb2", subject: "feat(COS-1e): polish passes — responsive rows", author: "Joe", committedAt: "2026-06-26T16:20:00Z", stat: { filesChanged: 4, insertions: 90, deletions: 40 } },
                ],
                // Open PR with a head-current SHIP review (report sha === branch head).
                pullRequests: [
                  {
                    prNumber: 361,
                    title: "feat(COS-1): daily-driver cockpit",
                    url: "https://github.com/j-emitch/paperclip/pull/361",
                    isDraft: false,
                    headRef: "docs/COS-1",
                    headSha: "f96d4ce0aa11",
                    updatedAt: "2026-06-26T16:52:00Z",
                    ticketIds: ["COS-1"],
                    review: { verdict: "ship", reportKind: "cannons", generatedAt: "2026-06-26T16:51:00Z", current: true, p0: 0, p1: 0, p2: 2 },
                  },
                ],
              },
            ],
            orphanPullRequests: [
              // A PR whose head ref is checked out on another machine — kept visible.
              {
                prNumber: 359,
                title: "feat(RE-30): cron-ownership boot guard",
                url: "https://github.com/j-emitch/paperclip/pull/359",
                isDraft: false,
                headRef: "cron/RE-30",
                headSha: "0aa9c1de44f0",
                updatedAt: "2026-06-25T09:00:00Z",
                ticketIds: ["RE-30"],
                review: { verdict: "proceed", reportKind: "review", generatedAt: "2026-06-24T09:00:00Z", current: false, p0: 0, p1: 1, p2: 3 },
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
                // K7 round 2: behind(14) < BEHIND_WARN(24) — no behind status.
                statuses: ["conflicting", "dirty"],
                attentionSeverity: "high",
                // COS-8d: a cannons report joined to THIS tip (the pre-push sha rule).
                reviewsForHead: [
                  { reportKind: "cannons", verdict: "ship", generatedAt: "2026-06-26T09:00:00Z", p0: 0, p1: 1, p2: 2, engines: [] },
                ],
                recentCommits: [
                  { sha: "a34ad7d31cc0", subject: "feat(SSF-04): forward-compat seam", author: "Joe", committedAt: "2026-06-23T16:00:00Z", stat: { filesChanged: 11, insertions: 230, deletions: 18 } },
                ],
                // DRAFT PR with a head-current BLOCKING review + p0 findings — surfaces
                // in BOTH the attention band (git conflicts) and the flagged-review axis.
                pullRequests: [
                  {
                    prNumber: 372,
                    title: "feat(SSF-04): reconciliation rehaul",
                    url: "https://github.com/j-emitch/juice-bar/pull/372",
                    isDraft: true,
                    headRef: "claude/SSF-04/reconciliation-rehaul",
                    headSha: "a34ad7d31cc0",
                    updatedAt: "2026-06-23T16:05:00Z",
                    ticketIds: ["SSF-04"],
                    review: { verdict: "block", reportKind: "cannons", generatedAt: "2026-06-23T16:04:00Z", current: true, p0: 1, p1: 2, p2: 0 },
                  },
                ],
              },
              {
                branch: "claude/PERF-02/read-pool",
                headSha: "cc17e90ab5f1",
                worktrees: [{ name: "perf-02", headSha: "cc17e90ab5f1", detached: false, dirtyFileCount: 0 }],
                trunk: trunkOk,
                comparison: "ok",
                ahead: 1,
                behind: 0,
                conflictsWithTrunk: false,
                lastCommitAt: "2026-06-26T14:00:00Z",
                staleDays: 0,
                statuses: [],
                attentionSeverity: "info",
                recentCommits: [
                  { sha: "cc17e90ab5f1", subject: "perf(PERF-02): keepalive-warm read pool", author: "Joe", committedAt: "2026-06-26T14:00:00Z", stat: { filesChanged: 3, insertions: 60, deletions: 8 } },
                ],
                // The local tip (cc17e90…) is AHEAD of the pushed PR head (9f0b2a…) —
                // exercises the "local ahead of PR head" note. Proceed review (stale).
                pullRequests: [
                  {
                    prNumber: 350,
                    title: "perf(PERF-02): resilient read pool",
                    url: "https://github.com/j-emitch/juice-bar/pull/350",
                    isDraft: false,
                    headRef: "claude/PERF-02/read-pool",
                    headSha: "9f0b2a71c4de",
                    updatedAt: "2026-06-25T10:00:00Z",
                    ticketIds: ["PERF-02"],
                    review: { verdict: "proceed", reportKind: "cannons", generatedAt: "2026-06-25T09:30:00Z", current: false, p0: 0, p1: 0, p2: 1 },
                  },
                ],
              },
            ],
            orphanPullRequests: [],
            // COS-8b: a real merge + a closed-via-ff-push row (rendered distinctly).
            landedPullRequests: [
              {
                prNumber: 396,
                title: "fix(GD-6): hook-drift heal",
                url: "https://github.com/j-emitch/JuiceBar/pull/396",
                headRef: "claude/GD-6/heal",
                landedAt: "2026-06-25T14:00:00Z",
                via: "merged",
                ticketIds: ["GD-6"],
              },
              {
                prNumber: 379,
                title: "feat(SSF-07): sale-identity claims",
                url: "https://github.com/j-emitch/JuiceBar/pull/379",
                headRef: "claude/SSF-07/claims",
                landedAt: "2026-06-24T10:00:00Z",
                via: "closed",
                ticketIds: ["SSF-07"],
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
                // K7 (COS-8e): stale is LOW — this branch is a cleanup-queue item,
                // no longer in the attention band.
                statuses: ["comparison_unavailable", "stale"],
                attentionSeverity: "low",
                recentCommits: [],
                pullRequests: [],
              },
            ],
            orphanPullRequests: [],
          },
        ],
      },
      {
        group: group("viacava-arts"),
        repos: [
          { repoKey: "viacava-arts", role: "primary", availability: "missing", trunk: { ref: null, state: "missing" }, branches: [], orphanPullRequests: [] },
        ],
      },
    ],
    sources: [
      { source: "branch", repo: "juice-bar", freshness: "live", lastOkAt: "2026-06-26T17:56:00Z", errorCount: 0, message: null },
      { source: "pull-request", repo: "juice-bar", freshness: "live", lastOkAt: "2026-06-26T17:56:00Z", errorCount: 0, message: null },
      { source: "branch", repo: "viacava-arts", freshness: "stale", lastOkAt: null, errorCount: 1, message: "repo not found on disk" },
    ],
    diagnostics: [],
  });
}

/** Everything derived but no repos resolved — the tab must render its calm 0-state. */
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
