/**
 * Golden `BoardStateV1` fixtures for the UI state-injection tests + the Playwright
 * harness. Built by running the REAL `deriveBoardState` projection over a curated
 * signal bundle, so the fixtures are contract-faithful by construction (never a
 * hand-rolled object that could drift from the schema) and exercise every visual
 * branch: all four columns, a cross-repo chip, reviewed + unknown In-review
 * states, a generic-prefix row, a stale source, derive diagnostics, and two
 * unclassified signals.
 */

import { deriveBoardState } from "../../../src/projections/deriveBoardState.js";
import type { BoardStateV1 } from "../../../src/contracts/index.js";
import type { RepoFreshness, SignalBatch } from "../../../src/contracts/WorkSignalSource.js";
import { NOW, review, taxon, work } from "../../fixtures/signals.js";

const TAXA = [
  taxon("COS", "Company OS", "Company", "Company-OS"),
  taxon("MTP", "Coaching engine", "JB", "Coaching"),
  taxon("SSF", "Sales reconciliation", "JB", "Coaching"),
  taxon("RE", "Reports", "JB", "Reports"),
  taxon("IMPRV", "Improvements", "JB", "Platform-infra", true),
];

const WORK = [
  // Company-OS lane — across all four columns.
  work("COS-0", "in_review", "pr_scope", { repo: "company", sha: "head1", prNumber: 5, url: "https://github.com/lycaon/paperclip/pull/5", title: "Company OS dev cockpit — Kanban UI" }),
  work("COS-1", "next_up", "spec_frontmatter", { repo: "company", title: "Teaching loop surface" }),
  work("COS-0e", "shipped", "commit_scope", { repo: "company", sha: "ship-e", title: "Kanban board rendering" }),
  // JB:Coaching lane — MTP (home repo) + a cross-repo SSF chip from arc-scraper.
  work("MTP-03", "in_progress", "branch_path", { repo: "juice-bar", title: "Movement-aware coaching insights" }),
  work("MTP-04", "shipped", "commit_scope", { repo: "juice-bar", sha: "ship-m4", title: "Rep MTP score serve path" }),
  work("MTP-07", "next_up", "spec_frontmatter", { repo: "juice-bar", title: "White Rabbit's Tip feedback loop" }),
  work("SSF-02", "shipped", "commit_scope", { repo: "arc-scraper", sha: "ship-s2", title: "Scrape-completion event spine" }),
  // JB:Reports lane — an In-review chip with NO matching review → unknown.
  work("RE-22", "in_review", "pr_scope", { repo: "juice-bar", sha: "head2", prNumber: 9, url: "https://github.com/lycaon/juice-bar/pull/9", title: "TAP flagship overview + REJ classification" }),
  work("RE-12", "in_progress", "commit_scope", { repo: "juice-bar", sha: "r12", title: "Monday week-start everywhere" }),
  // Generic row.
  work("IMPRV-14", "in_progress", "branch_path", { repo: "juice-bar", title: "knip unused-export sweep" }),
  // Unclassified — an unparseable branch + an unknown prefix.
  work(null, "in_progress", "none", { repo: "juice-bar", unclassifiedReason: "bad_branch_format", evidence: "claude/musing-burnell-8f4cb2" }),
  work("ZZ-9", "in_progress", "branch_path", { repo: "juice-bar", evidence: "claude/ZZ-9/experiment" }),
];

const REVIEW = [review("head1", { repo: "company", verdict: "ship" })];

const liveFreshness = (repo: string): RepoFreshness => ({ repo, freshness: "live", lastOkAt: "2026-06-23T11:59:30.000Z", errors: [] });

function goldenBatches(): SignalBatch[] {
  return [
    {
      source: "git-work",
      collectedAt: NOW,
      signals: [...TAXA, ...WORK, ...REVIEW],
      repoFreshness: [liveFreshness("juice-bar"), liveFreshness("company"), liveFreshness("arc-scraper")],
    },
    {
      // A flaky PR source — stale, but it never blanks the board (just a badge).
      source: "pull-request",
      collectedAt: NOW,
      signals: [],
      repoFreshness: [
        {
          repo: "juice-bar",
          freshness: "stale",
          lastOkAt: "2026-06-23T11:30:00.000Z",
          errors: [{ code: "gh_rate_limited", message: "GitHub API rate limit hit", degraded: true }],
        },
      ],
    },
  ];
}

/** A rich, fully-populated board. `deriveAtMs` controls `derivedAt` (fresh vs stale). */
export function goldenBoard(deriveAtMs: number = NOW): BoardStateV1 {
  return deriveBoardState({ collectedAt: deriveAtMs, batches: goldenBatches() }, deriveAtMs);
}

/** The same board, derived 10 minutes ago — trips the board-level stale badge. */
export function staleBoard(): BoardStateV1 {
  return goldenBoard(NOW - 10 * 60 * 1000);
}

/** An empty board: registered taxonomy (rows exist) but zero chips + zero unclassified. */
export function emptyBoard(deriveAtMs: number = NOW): BoardStateV1 {
  const batch: SignalBatch = {
    source: "git-work",
    collectedAt: deriveAtMs,
    signals: [...TAXA],
    repoFreshness: [liveFreshness("juice-bar"), liveFreshness("company")],
  };
  return deriveBoardState({ collectedAt: deriveAtMs, batches: [batch] }, deriveAtMs);
}

/** The render clock the SSR tests + harness use (30s after the default derive). */
export const RENDER_NOW = NOW + 30 * 1000;
