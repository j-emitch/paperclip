import { describe, expect, it } from "vitest";
import {
  BOARD_STALE_THRESHOLD_MS,
  buildBoardView,
  defaultCollapsedLaneIds,
  deriveAgeMs,
  isBoardEmpty,
  isBoardStale,
  relativeTime,
  staleSources,
} from "../../src/ui/board/view-model.js";
import { NOW } from "../fixtures/signals.js";
import { emptyBoard, goldenBoard, staleBoard } from "./fixtures/board.js";

describe("board view-model", () => {
  it("buckets chips into lane → row → column and keeps zero-count rows", () => {
    const view = buildBoardView(goldenBoard());
    const coaching = view.lanes.find((l) => l.lane.id === "JB:Coaching");
    expect(coaching).toBeTruthy();
    // Both MTP and SSF families render as rows under Coaching.
    expect(coaching?.rows.map((r) => r.row.prefix).sort()).toEqual(["MTP", "SSF"]);
    // Each row has exactly one cell per column, in board order.
    const mtp = coaching?.rows.find((r) => r.row.prefix === "MTP");
    expect(mtp?.cells.map((c) => c.column)).toEqual(["next_up", "in_progress", "in_review", "shipped"]);
    // MTP-04 shipped, MTP-03 in_progress, MTP-07 next_up.
    expect(mtp?.cells.find((c) => c.column === "shipped")?.chips.map((ch) => ch.id)).toContain("MTP-04");
    expect(mtp?.total).toBe(3);
  });

  it("separates the Ops lane + carries unclassified chips out of the classified lanes", () => {
    const view = buildBoardView(goldenBoard());
    expect(view.ops).toBeTruthy();
    expect(view.ops?.chips.length).toBe(2); // bad_branch_format + unknown_prefix
    // No classified lane is the Ops lane.
    expect(view.lanes.every((l) => !l.lane.isOps)).toBe(true);
  });

  it("isBoardEmpty is false for a populated board, true for a chips-and-unclassified-free board", () => {
    expect(isBoardEmpty(goldenBoard())).toBe(false);
    expect(isBoardEmpty(emptyBoard())).toBe(true);
  });

  it("isBoardStale flips at the 5-minute threshold", () => {
    const board = goldenBoard(NOW); // derived exactly at NOW
    expect(isBoardStale(board, NOW + BOARD_STALE_THRESHOLD_MS)).toBe(false); // == threshold, not over
    expect(isBoardStale(board, NOW + BOARD_STALE_THRESHOLD_MS + 1)).toBe(true);
    expect(deriveAgeMs(board, NOW + 1000)).toBe(1000);
  });

  it("staleBoard (derived 10m ago) is stale relative to NOW", () => {
    expect(isBoardStale(staleBoard(), NOW)).toBe(true);
  });

  it("staleSources surfaces only non-live sources", () => {
    const stale = staleSources(goldenBoard());
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.every((s) => s.freshness !== "live")).toBe(true);
    expect(stale.some((s) => s.source === "pull-request")).toBe(true);
  });

  it("relativeTime renders compact buckets + tolerates null/garbage", () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime("not-a-date", NOW)).toBeNull();
    expect(relativeTime(new Date(NOW - 30_000).toISOString(), NOW)).toBe("just now");
    expect(relativeTime(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe("4m ago");
    expect(relativeTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3h ago");
    expect(relativeTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2d ago");
  });

  it("defaultCollapsedLaneIds collapses empty lanes (and never lanes with chips)", () => {
    const empty = defaultCollapsedLaneIds(emptyBoard());
    // Every empty-board lane has zero chips → all collapsed by default.
    expect(empty.length).toBeGreaterThan(0);
    const populated = defaultCollapsedLaneIds(goldenBoard());
    // The Coaching lane has chips → must NOT be in the default-collapsed set.
    expect(populated).not.toContain("JB:Coaching");
  });
});
