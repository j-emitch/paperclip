/**
 * Golden + empty `OrientationV1` fixtures for the Home SSR tests. Built against
 * the real `taxonomyFixture()` so the project headers stay in lockstep with the
 * resolver, and validated through `parseOrientationV1` at construction so a fixture
 * can never drift from the contract.
 */

import {
  parseOrientationV1,
  type OrientationV1,
} from "../../../src/contracts/index.js";
import { taxonomyFixture } from "../../fixtures/taxonomy.js";

export const HOME_NOW = Date.parse("2026-06-26T18:00:00Z");

export function goldenOrientation(): OrientationV1 {
  return parseOrientationV1({
    schemaVersion: 1,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: taxonomyFixture(),
    briefing: [
      {
        routineKey: "daily-standup",
        displayName: "Daily Standup — what moved overnight",
        ownerAgent: "CEO",
        freshnessKind: "artifact",
        verdict: "fresh",
        reportDate: "2026-06-26T13:00:00Z",
        repo: "company",
        relPath: "reports/routines/daily-standup/2026-06-26.md",
      },
      {
        routineKey: "codebase-health",
        displayName: "Daily Codebase Awareness",
        ownerAgent: "CTO",
        freshnessKind: "artifact",
        verdict: "stale",
        reportDate: "2026-06-24T13:00:00Z",
        repo: "company",
        relPath: "reports/routines/codebase-health/2026-06-24.md",
      },
    ],
    metrics: { openPrs: 3, inProgress: 5, alerts: 2, branchesNeedingAttention: 2, dirtyWorktrees: 1 },
    branchHealth: [
      {
        projectKey: "juice-bar",
        repo: "juice-bar",
        branch: "claude/SSF-04/reconciliation-rehaul",
        statuses: ["conflicting", "behind", "dirty"],
        severity: "high",
        behind: 14,
        staleDays: 3,
        deepLink: { tab: "source", repoKey: "juice-bar", branch: "claude/SSF-04/reconciliation-rehaul" },
      },
      {
        projectKey: "juice-bar",
        repo: "arc-scraper",
        branch: "mtpfeed-01a-arc",
        statuses: ["behind", "stale"],
        severity: "medium",
        behind: 6,
        staleDays: 15,
        deepLink: { tab: "source", repoKey: "arc-scraper", branch: "mtpfeed-01a-arc" },
      },
    ],
    recentCommits: [
      {
        projectKey: "juice-bar",
        repo: "juice-bar",
        branch: "main",
        sha: "44edce328aa1bc",
        subject: "docs: add User Roles & Audiences canon to CLAUDE.md",
        committedAt: "2026-06-26T16:40:00Z",
      },
      {
        projectKey: "company",
        repo: "company",
        branch: "main",
        sha: "928bdb5f0e21",
        subject: "feat(COS-0): ship the company-os cockpit",
        committedAt: "2026-06-26T15:10:00Z",
      },
    ],
    recentWork: [
      {
        projectKey: "juice-bar",
        system: "JB",
        kind: "spec",
        title: "SSF-04 reconciliation rehaul",
        status: "in_progress",
        updatedAt: "2026-06-26T16:00:00Z",
        deepLink: { tab: "board", workId: "SSF-04" },
      },
      {
        projectKey: "company",
        system: "COS",
        kind: "plan",
        title: "COS-1 daily-driver cockpit plan",
        status: "approved",
        updatedAt: "2026-06-25T20:00:00Z",
        deepLink: { tab: "docs", docId: "[\"company\",\"main\",\"docs/superpowers/plans/2026-06-25-COS-1.md\"]" },
      },
    ],
    alerts: [
      {
        id: "branch:juice-bar:claude/SSF-04/reconciliation-rehaul",
        projectKey: "juice-bar",
        kind: "branch_at_risk",
        severity: "high",
        title: "SSF-04 branch conflicts with main",
        detail: "claude/SSF-04/reconciliation-rehaul is 14 behind and conflicts with main.",
        deepLink: { tab: "source", repoKey: "juice-bar", branch: "claude/SSF-04/reconciliation-rehaul" },
      },
      {
        id: "routine:codebase-health",
        projectKey: "company",
        kind: "routine_stale",
        severity: "medium",
        title: "Codebase-health routine is stale",
        detail: "Last ran 2 days ago — past its daily cadence.",
        deepLink: { tab: "docs", docId: "[\"company\",\"main\",\"reports/routines/codebase-health/2026-06-24.md\"]" },
      },
    ],
    sources: [
      { source: "branch", repo: "juice-bar", freshness: "live", lastOkAt: "2026-06-26T17:56:00Z", errorCount: 0, message: null },
      { source: "pull-request", repo: "juice-bar", freshness: "stale", lastOkAt: "2026-06-26T12:00:00Z", errorCount: 2, message: "gh rate-limited" },
    ],
    diagnostics: [],
  });
}

/** Everything derived but empty — Home must render every panel's calm 0-state. */
export function emptyOrientation(): OrientationV1 {
  return parseOrientationV1({
    schemaVersion: 1,
    derivedAt: "2026-06-26T17:56:00Z",
    taxonomy: taxonomyFixture(),
    briefing: [],
    metrics: { openPrs: 0, inProgress: 0, alerts: 0, branchesNeedingAttention: 0, dirtyWorktrees: 0 },
    branchHealth: [],
    recentCommits: [],
    recentWork: [],
    alerts: [],
    sources: [],
    diagnostics: [],
  });
}
