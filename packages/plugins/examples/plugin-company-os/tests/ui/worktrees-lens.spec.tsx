/**
 * COS-8c T4 — `WorktreesLens` SSR states: the activity-gate header
 * ("evaluated N/M (activity-gated)" + skipped-dirty names — the AC-8c#3 UI
 * assertion), lane grouping with show-0-counts, origin badges, the NAMED
 * rung chip, COH artifacts, cleanup-receipt kinds, the docs-updated chip,
 * worktree-less cards, and the calm empty state.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreesLens } from "../../src/ui/branch-pr/WorktreesLens.js";
import {
  WORKTREE_BOARD_SCHEMA_VERSION,
  parseWorktreeBoardV1,
  type WorktreeBoardV1,
  type WorktreeCardV1,
} from "../../src/contracts/worktree-board.js";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");

function card(over: Partial<WorktreeCardV1>): WorktreeCardV1 {
  return {
    cardKey: over.cardKey ?? `company::wt::${over.worktreeName ?? "wt"}`,
    repoKey: "company",
    hasWorktree: true,
    checkoutKey: `company::wt::abcabcabcabc`,
    worktreeName: "cos-wt",
    branch: "claude/COS-8/build",
    origin: "claude",
    lane: "in_flight",
    laneSource: "heuristic",
    rung: "tip-recent",
    headSha: "abc123",
    dirtyFileCount: 0,
    ahead: 2,
    behind: 1,
    lastCommitAt: new Date(NOW - 3_600_000).toISOString(),
    changedFiles: ["src/a.ts"],
    changedFilesTruncated: false,
    mergeStatus: "none",
    docChangedCount: 0,
    ticketIds: [],
    slug: null,
    checkpointCount: 0,
    latestCheckpointAt: null,
    latestWip: null,
    latestPushed: null,
    activeHandoff: null,
    cleanupKind: null,
    ...over,
  };
}

function board(cards: WorktreeCardV1[], over: { evaluated?: number; total?: number; skippedDirty?: string[] } = {}): WorktreeBoardV1 {
  return parseWorktreeBoardV1({
    schemaVersion: WORKTREE_BOARD_SCHEMA_VERSION,
    derivedAt: new Date(NOW).toISOString(),
    repos: [
      {
        repoKey: "company",
        evaluated: over.evaluated ?? cards.length,
        total: over.total ?? cards.length,
        skippedDirty: over.skippedDirty ?? [],
        overlapPairs: [],
        cards,
      },
    ],
    diagnostics: [],
  });
}

describe("WorktreesLens SSR", () => {
  it("AC-8c#3: header renders evaluated N/M (activity-gated) + skipped-dirty NAMES", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([card({ worktreeName: "evaluated-wt" })], { evaluated: 1, total: 3, skippedDirty: ["hot-dirty-a", "hot-dirty-b"] })}
        now={NOW}
      />,
    );
    expect(html).toContain("evaluated 1/3 (activity-gated)");
    expect(html).toContain("hot-dirty-a");
    expect(html).toContain("hot-dirty-b");
    expect(html).toContain("DIRTY tree");
  });

  it("shows every lane count (incl. 0) and groups cards by lane", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([
          card({ worktreeName: "hot", cardKey: "k1", lane: "needs_attention", rung: "behind-heavy" }),
          card({ worktreeName: "wip", cardKey: "k2", lane: "in_flight" }),
        ])}
        now={NOW}
      />,
    );
    expect(html).toContain("Needs attention 1");
    expect(html).toContain("In flight 1");
    expect(html).toContain("Merged · cleanup 0"); // show-0-counts
    expect(html).toContain("Stale 0");
    expect(html).toContain("behind-heavy"); // the rung chip
  });

  it("renders COH artifacts: tickets, checkpoints + recency, handoff-pending chip", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([
          card({
            worktreeName: "coh-tree",
            ticketIds: ["COH-4a"],
            checkpointCount: 12,
            latestCheckpointAt: new Date(NOW - 7_200_000).toISOString(),
            activeHandoff: "reports/handoffs/x.md",
          }),
        ])}
        now={NOW}
      />,
    );
    expect(html).toContain("COH-4a");
    expect(html).toContain("12 checkpoints");
    expect(html).toContain("handoff pending");
  });

  it("cleanup receipts: coh promote for claude trees, raw git ONLY for external", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([
          card({ worktreeName: "done-claude", cardKey: "k1", lane: "merged_cleanup", cleanupKind: "coh_promote", rung: "merged:squash" }),
          card({
            worktreeName: "done-ext",
            cardKey: "k2",
            lane: "merged_cleanup",
            cleanupKind: "raw_git",
            origin: "external",
            branch: "feature/x",
            rung: "merged:direct",
          }),
        ])}
        now={NOW}
      />,
    );
    expect(html).toContain("coh promote");
    expect(html).toContain("git worktree remove done-ext");
    expect(html).toContain("merged:squash");
  });

  it("docs-updated chip renders from docChangedCount + a changed .md", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([card({ worktreeName: "doc-tree", docChangedCount: 2, changedFiles: ["specs/x.md", "docs/y.md", "src/a.ts"] })])}
        now={NOW}
      />,
    );
    expect(html).toContain("2 docs updated");
  });

  it("worktree-less branch cards show the branch, the no-worktree pill, and the rung", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([
          card({
            cardKey: "branch:company:claude/B-2/solo",
            hasWorktree: false,
            checkoutKey: null,
            worktreeName: null,
            branch: "claude/B-2/solo",
            rung: "tip-recent",
            dirtyFileCount: null,
            changedFiles: null,
          }),
        ])}
        now={NOW}
      />,
    );
    expect(html).toContain("no worktree");
    expect(html).toContain("claude/B-2/solo");
    expect(html).toContain("tip-recent");
  });

  it("COS-8g: renders the conflict radar — HOT pair styling + shared files + empty state", () => {
    const withPairs = parseWorktreeBoardV1({
      schemaVersion: WORKTREE_BOARD_SCHEMA_VERSION,
      derivedAt: new Date(NOW).toISOString(),
      repos: [
        {
          repoKey: "company",
          evaluated: 2,
          total: 2,
          skippedDirty: [],
          overlapPairs: [
            { branchA: "claude/H-1/a", branchB: "claude/H-2/b", sharedFiles: ["src/x.ts", "src/y.ts", "src/z.ts", "src/w.ts"], count: 4, bothDirty: true },
          ],
          cards: [card({ worktreeName: "a", cardKey: "ka" })],
        },
      ],
      diagnostics: [],
    });
    const hot = renderToStaticMarkup(<WorktreesLens board={withPairs} now={NOW} />);
    expect(hot).toContain("Conflict radar");
    expect(hot).toContain("HOT · both dirty");
    expect(hot).toContain("claude/H-1/a ↔ claude/H-2/b");
    expect(hot).toContain("4 shared files");
    expect(hot).toContain("+1 more"); // 3 shown of 4

    const none = renderToStaticMarkup(<WorktreesLens board={board([card({})])} now={NOW} />);
    expect(none).toContain("No overlapping in-flight changes.");
  });

  it("renders the calm empty state for a boardless workspace", () => {
    const empty = parseWorktreeBoardV1({
      schemaVersion: WORKTREE_BOARD_SCHEMA_VERSION,
      derivedAt: new Date(NOW).toISOString(),
      repos: [],
      diagnostics: [],
    });
    const html = renderToStaticMarkup(<WorktreesLens board={empty} now={NOW} />);
    expect(html).toContain("No worktrees or in-flight branches");
  });
});

describe("QUAD folds: wt deep-link focus (AC-8f symmetry)", () => {
  it("a matching focus target renders the focused card ring", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([card({ worktreeName: "cos-wt" })])}
        now={NOW}
        focusWt={{ repoKey: "company", wt: "cos-wt", ck: "abcabcabcabc" }}
      />,
    );
    expect(html).toContain('data-focused="true"');
    expect(html).not.toContain("may have been merged and cleaned up");
  });

  it("an unmatched focus target renders the typed miss note (a dead link must LOOK dead)", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([card({ worktreeName: "cos-wt" })])}
        now={NOW}
        focusWt={{ repoKey: "company", wt: "pruned-tree", ck: null }}
      />,
    );
    expect(html).toContain("pruned-tree");
    expect(html).toContain("may have been merged and cleaned up");
    expect(html).not.toContain('data-focused="true"');
  });

  it("ck narrows: same basename, wrong hash -> miss", () => {
    const html = renderToStaticMarkup(
      <WorktreesLens
        board={board([card({ worktreeName: "cos-wt" })])}
        now={NOW}
        focusWt={{ repoKey: "company", wt: "cos-wt", ck: "ffffffffffff" }}
      />,
    );
    expect(html).toContain("may have been merged and cleaned up");
  });
});

describe("radar display cap (live-data fold: JB emitted 411 pairs)", () => {
  it("shows the top pairs and summarizes the remainder, never silently drops", () => {
    const pairs = Array.from({ length: 15 }, (_, i) => ({
      branchA: `claude/A-${i}/x`,
      branchB: `claude/B-${i}/y`,
      sharedFiles: ["src/x.ts"],
      count: 15 - i,
      bothDirty: false,
    }));
    const withMany = parseWorktreeBoardV1({
      schemaVersion: WORKTREE_BOARD_SCHEMA_VERSION,
      derivedAt: new Date(NOW).toISOString(),
      repos: [{ repoKey: "company", evaluated: 2, total: 2, skippedDirty: [], overlapPairs: pairs, cards: [card({})] }],
      diagnostics: [],
    });
    const html = renderToStaticMarkup(<WorktreesLens board={withMany} now={NOW} />);
    expect(html).toContain("claude/A-0/x");
    expect(html).toContain("claude/A-11/x"); // 12th shown
    expect(html).not.toContain("claude/A-12/x"); // 13th capped
    expect(html).toContain("+3 more overlapping pairs");
  });
});
