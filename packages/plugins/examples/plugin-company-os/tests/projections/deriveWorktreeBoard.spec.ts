/**
 * COS-8c T2 — `deriveWorktreeBoard`: lane ladder (merged wins clean trees,
 * Work Record outranks heuristics, heuristics fill the rest), AC-8c#2
 * (squash-merged lands `merged_cleanup`, never `stale`), cleanup-receipt
 * kinds (item 1), worktree-less branch cards with a named rung (Fable
 * major 6), the evaluated-N/M + skipped-dirty header data, and the NAMED
 * 85-worktree perf budget (AC-8c#5).
 */

import { describe, expect, it } from "vitest";
import { deriveWorktreeBoard } from "../../src/projections/deriveWorktreeBoard.js";
import { WORKTREE_BUDGET_MS } from "../../src/contracts/worktree-board.js";
import type { WorktreePurpose } from "../../src/contracts/signals.js";
import { NOW, branchSignal, bundleOf, bundleOfBatches, worktreeSignal } from "../fixtures/signals.js";

const DAY = 86_400_000;
const OLD_TIP = new Date(NOW - 40 * DAY).toISOString();

function purposeWith(wip: boolean, pushed: boolean): WorktreePurpose {
  return {
    ticketIds: ["COS-8c"],
    slug: "worktrees-lens",
    phase: "build",
    lifespan: "phase",
    startedAt: "2026-06-20T00:00:00Z",
    activeHandoff: null,
    integrationTarget: "main",
    checkpoints: [{ headSha: "abc", wip, pushed, at: "2026-06-22T10:00:00Z" }],
  };
}

describe("lane ladder", () => {
  it("AC-8c#2: a squash-merged CLEAN tree lands merged_cleanup (never stale) — even when stale-tipped", () => {
    const board = deriveWorktreeBoard(
      bundleOf([worktreeSignal("squashed", { mergeStatus: "squash", lastCommitAt: OLD_TIP, dirtyFileCount: 0 })]),
      NOW,
    );
    const card = board.repos[0].cards[0];
    expect(card.lane).toBe("merged_cleanup");
    expect(card.rung).toBe("merged:squash");
  });

  it("a DIRTY tree on a merged branch is NOT cleanup (new work on top)", () => {
    const board = deriveWorktreeBoard(
      bundleOf([worktreeSignal("dirty-on-merged", { mergeStatus: "squash", dirtyFileCount: 3 })]),
      NOW,
    );
    expect(board.repos[0].cards[0].lane).toBe("in_flight");
  });

  it("Work Record wip/pushed is the status source where present (rung names it)", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("wr-wip", { purpose: purposeWith(true, false) }),
        worktreeSignal("wr-pushed", { purpose: purposeWith(false, true) }),
      ]),
      NOW,
    );
    const wip = board.repos[0].cards.find((c) => c.worktreeName === "wr-wip")!;
    const pushed = board.repos[0].cards.find((c) => c.worktreeName === "wr-pushed")!;
    expect(wip).toMatchObject({ lane: "in_flight", laneSource: "work_record", rung: "work-record:wip", latestWip: true });
    expect(pushed).toMatchObject({ lane: "in_flight", laneSource: "work_record", rung: "work-record:pushed" });
  });

  it("heuristics fill Work-Record-absent trees: dirty-stale/behind-heavy → needs_attention; stale-tip → stale", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("dirty-stale", { dirtyFileCount: 2, lastCommitAt: OLD_TIP }),
        worktreeSignal("behind-heavy", { behind: 12 }),
        worktreeSignal("just-old", { lastCommitAt: OLD_TIP }),
        worktreeSignal("fresh", {}),
      ]),
      NOW,
    );
    const lane = (name: string) => board.repos[0].cards.find((c) => c.worktreeName === name)!;
    expect(lane("dirty-stale")).toMatchObject({ lane: "needs_attention", rung: "dirty-stale", laneSource: "heuristic" });
    expect(lane("behind-heavy")).toMatchObject({ lane: "needs_attention", rung: "behind-heavy" });
    expect(lane("just-old")).toMatchObject({ lane: "stale", rung: "stale-tip" });
    expect(lane("fresh")).toMatchObject({ lane: "in_flight", rung: "tip-recent" });
  });

  it("cleanup receipts: coh_promote for claude/codex origins, raw_git ONLY for external (item 1)", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("claude-merged", { mergeStatus: "direct", origin: "claude" }),
        worktreeSignal("ext-merged", { mergeStatus: "direct", origin: "external", branch: "feature/x" }),
        worktreeSignal("live", {}),
      ]),
      NOW,
    );
    const of = (name: string) => board.repos[0].cards.find((c) => c.worktreeName === name)!;
    expect(of("claude-merged").cleanupKind).toBe("coh_promote");
    expect(of("ext-merged").cleanupKind).toBe("raw_git");
    expect(of("live").cleanupKind).toBeNull();
  });
});

describe("worktree-less branches (intent ladder minus _purpose)", () => {
  it("mints a card with the resolved rung named; trunk and worktree-covered branches excluded", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("has-tree", { branch: "claude/A-1/x" }),
        branchSignal("claude/A-1/x", { worktrees: [], repo: "company" }), // covered by the worktree card
        branchSignal("claude/B-2/solo", { worktrees: [], lastCommitAt: new Date(NOW - DAY).toISOString() }),
        branchSignal("main", { worktrees: [] }), // trunk — never a card
      ]),
      NOW,
    );
    const cards = board.repos.flatMap((r) => r.cards);
    expect(cards.filter((c) => c.branch === "claude/A-1/x")).toHaveLength(1); // no double card
    const solo = cards.find((c) => c.branch === "claude/B-2/solo")!;
    expect(solo.hasWorktree).toBe(false);
    expect(solo.checkoutKey).toBeNull();
    expect(solo.rung).toBe("tip-recent");
    expect(cards.some((c) => c.branch === "main")).toBe(false);
  });

  it("a conflict-predicted branch needs attention", () => {
    const board = deriveWorktreeBoard(
      bundleOf([branchSignal("claude/C-3/hot", { worktrees: [], conflictsWithTrunk: true })]),
      NOW,
    );
    expect(board.repos[0].cards[0]).toMatchObject({ lane: "needs_attention", rung: "conflicts-predicted" });
  });
});

describe("activity-gate header data", () => {
  it("evaluated/total + skippedDirty derive from the changedFiles null pattern", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("evaluated-1", { changedFiles: ["a.ts"] }),
        worktreeSignal("skipped-clean", { changedFiles: null, lastCommitAt: OLD_TIP }),
        worktreeSignal("skipped-dirty", { changedFiles: null, dirtyFileCount: 4, lastCommitAt: OLD_TIP }),
      ]),
      NOW,
    );
    const section = board.repos[0];
    expect(section.total).toBe(3);
    expect(section.evaluated).toBe(1);
    expect(section.skippedDirty).toEqual(["skipped-dirty"]);
  });

  it("docChangedCount counts .md changedFiles (the docs-updated chip input)", () => {
    const board = deriveWorktreeBoard(
      bundleOf([worktreeSignal("doc-heavy", { changedFiles: ["specs/x.md", "src/a.ts", "docs/y.md"] })]),
      NOW,
    );
    expect(board.repos[0].cards[0].docChangedCount).toBe(2);
  });
});

describe("COS-8g: overlapPairs conflict radar", () => {
  it("two dirty overlapping trees produce a HOT pair, count-ranked", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("hot-a", { branch: "claude/H-1/a", dirtyFileCount: 2, changedFiles: ["src/x.ts", "src/y.ts", "src/z.ts"] }),
        worktreeSignal("hot-b", { branch: "claude/H-2/b", dirtyFileCount: 1, changedFiles: ["src/x.ts", "src/y.ts"] }),
        worktreeSignal("cool-c", { branch: "claude/H-3/c", dirtyFileCount: 0, changedFiles: ["src/x.ts"] }),
      ]),
      NOW,
    );
    const pairs = board.repos[0].overlapPairs;
    expect(pairs[0]).toMatchObject({ branchA: "claude/H-1/a", branchB: "claude/H-2/b", count: 2, bothDirty: true });
    expect(pairs[0].sharedFiles).toEqual(["src/x.ts", "src/y.ts"]);
    // clean overlaps still appear, not hot, ranked below
    expect(pairs.some((p) => p.bothDirty === false)).toBe(true);
    expect(pairs.every((p, i) => i === 0 || pairs[i - 1].count >= p.count)).toBe(true);
  });

  it("zero overlap → empty; unevaluated + merged trees never radar", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("solo-1", { branch: "claude/Z-1/a", changedFiles: ["a.ts"] }),
        worktreeSignal("solo-2", { branch: "claude/Z-2/b", changedFiles: ["b.ts"] }),
        worktreeSignal("null-diff", { branch: "claude/Z-3/c", changedFiles: null }),
        worktreeSignal("merged", { branch: "claude/Z-4/d", changedFiles: ["a.ts"], mergeStatus: "squash", dirtyFileCount: 0 }),
      ]),
      NOW,
    );
    expect(board.repos[0].overlapPairs).toEqual([]);
  });

  it("sharedFiles caps at 10 names while count keeps the full size", () => {
    const many = Array.from({ length: 14 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("big-a", { branch: "claude/B-1/a", changedFiles: many }),
        worktreeSignal("big-b", { branch: "claude/B-2/b", changedFiles: many }),
      ]),
      NOW,
    );
    const pair = board.repos[0].overlapPairs[0];
    expect(pair.count).toBe(14);
    expect(pair.sharedFiles).toHaveLength(10);
  });
});

describe("perf: 85-worktree fixture completes within WORKTREE_BUDGET_MS (AC-8c#5)", () => {
  it("derives an 85-tree repo (the audit-time JB count) under the per-repo budget", () => {
    const signals = Array.from({ length: 85 }, (_, i) =>
      worktreeSignal(`jb-wt-${String(i).padStart(2, "0")}`, {
        repo: "juice-bar",
        dirtyFileCount: i % 3 === 0 ? 2 : 0,
        changedFiles: i < 32 ? ["src/f.ts"] : null,
      }),
    );
    const started = Date.now();
    const board = deriveWorktreeBoard(bundleOf(signals), NOW);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(WORKTREE_BUDGET_MS);
    const section = board.repos.find((r) => r.repoKey === "juice-bar")!;
    expect(section.total).toBe(85);
    expect(section.evaluated).toBe(32);
    expect(section.cards).toHaveLength(85);
  });
});

describe("QUAD folds: degraded scans, provenance, diagnostics threading", () => {
  it("all-null git reads -> needs_attention with the scan-degraded rung, never a quiet stale", () => {
    const board = deriveWorktreeBoard(
      bundleOf([
        worktreeSignal("ghost-tree", { headSha: null, dirtyFileCount: null, lastCommitAt: null, ahead: null, behind: null, changedFiles: null }),
      ]),
      NOW,
    );
    const card = board.repos[0].cards[0];
    expect(card.lane).toBe("needs_attention");
    expect(card.rung).toBe("scan-degraded");
  });

  it("attention OVERLAY on a work-record tree carries laneSource heuristic (provenance not conflated)", () => {
    const purpose: WorktreePurpose = {
      ticketIds: ["X-1"],
      slug: "x",
      phase: null,
      lifespan: null,
      startedAt: null,
      activeHandoff: null,
      integrationTarget: null,
      checkpoints: [{ headSha: "abc", wip: true, pushed: false, at: new Date(NOW - 3_600_000).toISOString() }],
    };
    const board = deriveWorktreeBoard(
      bundleOf([worktreeSignal("wr-behind", { purpose, behind: 40, dirtyFileCount: 0 })]),
      NOW,
    );
    const card = board.repos[0].cards[0];
    expect(card.lane).toBe("needs_attention");
    expect(card.rung).toBe("behind-heavy");
    expect(card.laneSource).toBe("heuristic"); // the overlay decided, not the Work Record
  });

  it("worktree-source repo errors thread into board diagnostics (degradation is carried, not dropped)", () => {
    const board = deriveWorktreeBoard(
      bundleOfBatches([
        {
          source: "worktree",
          collectedAt: NOW,
          signals: [worktreeSignal("capped-tree")],
          repoFreshness: [
            {
              repo: "company",
              freshness: "live",
              lastOkAt: new Date(NOW).toISOString(),
              errors: [{ code: "worktree_diff_capped", message: "capped for company", degraded: true }],
            },
          ],
        },
      ]),
      NOW,
    );
    expect(board.diagnostics.some((d) => d.code === "worktree_diff_capped" && d.repo === "company")).toBe(true);
  });
});
