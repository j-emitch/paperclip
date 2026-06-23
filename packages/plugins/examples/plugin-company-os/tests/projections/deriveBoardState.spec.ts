import { describe, expect, it } from "vitest";
import { deriveBoardState } from "../../src/projections/deriveBoardState.js";
import { parseBoardStateV1 } from "../../src/contracts/board-state.js";
import { NOW, bundleOf, bundleOfBatches, review, taxon, work } from "../fixtures/signals.js";
import type { SignalBatch } from "../../src/contracts/WorkSignalSource.js";

const TAXA = [
  taxon("COS", "Company OS", "Company", "Company-OS"),
  taxon("OB", "Onboarding", "JB", "Onboarding"),
  taxon("IMPRV", "Improvements", "JB", "Platform-infra", true),
];

describe("deriveBoardState — placement", () => {
  it("places a chip in the furthest-right stage with a live signal", () => {
    // COS-0 has next_up (spec) + in_progress (branch) + in_review (PR) → in_review wins.
    const board = deriveBoardState(
      bundleOf([
        ...TAXA,
        work("COS-0", "next_up", "spec_frontmatter"),
        work("COS-0", "in_progress", "branch_path"),
        work("COS-0", "in_review", "pr_scope", { prNumber: 5, sha: "abc", url: "u" }),
      ]),
      NOW,
    );
    const chip = board.chips.find((c) => c.id === "COS-0");
    expect(chip).toMatchObject({ column: "in_review", precedence: "pr_scope", prNumber: 5, laneId: "Company:Company-OS" });
    expect(() => parseBoardStateV1(board)).not.toThrow();
  });

  it("uses the strongest-precedence signal FOR the resolved column for chip metadata", () => {
    // Two in_progress candidates: branch_path beats commit_scope.
    const board = deriveBoardState(
      bundleOf([
        ...TAXA,
        work("OB-01", "in_progress", "commit_scope", { sha: "weak", evidence: "commit" }),
        work("OB-01", "in_progress", "branch_path", { evidence: "claude/OB-01/x" }),
      ]),
      NOW,
    );
    expect(board.chips.find((c) => c.id === "OB-01")).toMatchObject({ precedence: "branch_path", column: "in_progress" });
  });

  it("a non-reverted shipped signal wins; a revert-only ticket is un-shipped (no chip)", () => {
    const board = deriveBoardState(
      bundleOf([
        ...TAXA,
        work("OB-01", "shipped", "commit_scope", { sha: "m1" }),
        work("COS-0", "shipped", "commit_scope", { sha: "r1", reverted: true }),
      ]),
      NOW,
    );
    expect(board.chips.find((c) => c.id === "OB-01")?.column).toBe("shipped");
    expect(board.chips.find((c) => c.id === "COS-0")).toBeUndefined(); // un-shipped
  });

  it("ship-then-revert un-ships, but a later re-ship re-ships (newest committer-date wins)", () => {
    // OB-01: ship @ 05-01, revert @ 05-02 → newest is the revert → NOT shipped.
    // COS-0: revert @ 05-01, re-ship @ 05-02 → newest is the ship → shipped.
    const board = deriveBoardState(
      bundleOf([
        ...TAXA,
        work("OB-01", "shipped", "commit_scope", { sha: "a", mtime: "2026-05-01T00:00:00Z" }),
        work("OB-01", "shipped", "commit_scope", { sha: "b", reverted: true, mtime: "2026-05-02T00:00:00Z" }),
        work("COS-0", "shipped", "commit_scope", { sha: "c", reverted: true, mtime: "2026-05-01T00:00:00Z" }),
        work("COS-0", "shipped", "commit_scope", { sha: "d", mtime: "2026-05-02T00:00:00Z" }),
      ]),
      NOW,
    );
    expect(board.chips.find((c) => c.id === "OB-01")).toBeUndefined(); // ship→revert = un-shipped
    expect(board.chips.find((c) => c.id === "COS-0")?.column).toBe("shipped"); // revert→re-ship = shipped
  });
});

describe("deriveBoardState — lanes/rows/taxonomy", () => {
  it("seeds a row per registered prefix (0-count rows shown) under its lane", () => {
    const board = deriveBoardState(bundleOf([...TAXA]), NOW);
    expect(board.rows.map((r) => r.prefix).sort()).toEqual(["COS", "IMPRV", "OB"]);
    expect(board.rows.find((r) => r.prefix === "IMPRV")?.isGeneric).toBe(true);
    expect(board.lanes.map((l) => l.id)).toContain("Company:Company-OS");
  });

  it("records the chip's repo on its row (cross-repo badge source)", () => {
    const board = deriveBoardState(
      bundleOf([...TAXA, work("OB-01", "in_progress", "branch_path", { repo: "juice-bar" })]),
      NOW,
    );
    expect(board.rows.find((r) => r.prefix === "OB")?.repos).toEqual(["juice-bar"]);
  });

  it("columns are exactly the canonical work-states in order", () => {
    const board = deriveBoardState(bundleOf([...TAXA]), NOW);
    expect(board.columns).toEqual(["next_up", "in_progress", "in_review", "shipped"]);
  });
});

describe("deriveBoardState — unclassified", () => {
  it("a null-ticket signal lands in Ops with its reason + the Ops lane appears", () => {
    const board = deriveBoardState(
      bundleOf([...TAXA, work(null, "in_progress", "none", { unclassifiedReason: "bad_branch_format", evidence: "random" })]),
      NOW,
    );
    expect(board.unclassified[0]).toMatchObject({ reason: "bad_branch_format", evidence: "random" });
    expect(board.lanes.find((l) => l.isOps)).toMatchObject({ id: "Ops", isOps: true });
  });

  it("a parsed ticket with an unregistered prefix → unknown_prefix + a register hint", () => {
    const board = deriveBoardState(bundleOf([...TAXA, work("ZZ-9", "in_progress", "branch_path")]), NOW);
    const u = board.unclassified.find((c) => c.id === "ZZ-9");
    expect(u).toMatchObject({ reason: "unknown_prefix", prefix: "ZZ" });
    expect(u?.hint).toMatch(/register "ZZ"/);
    expect(board.chips.some((c) => c.id === "ZZ-9")).toBe(false);
  });
});

describe("deriveBoardState — In-review review-state join", () => {
  it("reviewed when a head-SHA-current report matches; unknown otherwise", () => {
    const board = deriveBoardState(
      bundleOf([
        ...TAXA,
        work("OB-01", "in_review", "pr_scope", { sha: "headsha", prNumber: 9 }),
        work("COS-0", "in_review", "pr_scope", { sha: "othersha", prNumber: 10 }),
        review("headsha", { repo: "juice-bar", verdict: "ship" }),
        review("staleold", { repo: "juice-bar" }),
      ]),
      NOW,
    );
    expect(board.chips.find((c) => c.id === "OB-01")?.reviewState).toBe("reviewed");
    expect(board.chips.find((c) => c.id === "COS-0")?.reviewState).toBe("unknown");
  });

  it("non-in_review chips carry null reviewState", () => {
    const board = deriveBoardState(bundleOf([...TAXA, work("OB-01", "in_progress", "branch_path")]), NOW);
    expect(board.chips.find((c) => c.id === "OB-01")?.reviewState).toBeNull();
  });
});

describe("deriveBoardState — freshness + diagnostics", () => {
  it("aggregates per-source freshness and emits a warn diagnostic per stale source", () => {
    const batches: SignalBatch[] = [
      { source: "pull-request", collectedAt: NOW, signals: [], repoFreshness: [{ repo: "juice-bar", freshness: "stale", lastOkAt: null, errors: [{ code: "gh_unauthenticated", message: "gh auth fail", degraded: true }] }] },
      { source: "git-work", collectedAt: NOW, signals: [...TAXA], repoFreshness: [{ repo: "juice-bar", freshness: "live", lastOkAt: "t", errors: [] }] },
    ];
    const board = deriveBoardState(bundleOfBatches(batches), NOW);
    expect(board.sources.find((s) => s.source === "pull-request")).toMatchObject({ freshness: "stale", errorCount: 1 });
    expect(board.diagnostics.find((d) => d.source === "pull-request")).toMatchObject({ level: "warn", code: "source_stale" });
  });
});
