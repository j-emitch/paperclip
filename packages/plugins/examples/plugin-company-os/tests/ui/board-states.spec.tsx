import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyOsBoardView } from "../../src/ui/board/CompanyOsBoardView.js";
import { EmptyState, ErrorState, LoadingState } from "../../src/ui/board/states.js";
import { BOARD_STYLE_ID } from "../../src/ui/board/board-styles.js";
import { NOW } from "../fixtures/signals.js";
import { barrenBoard, goldenBoard, RENDER_NOW, staleBoard, zeroChipBoard } from "./fixtures/board.js";
import { isBoardEmpty } from "../../src/ui/board/view-model.js";

const noop = () => {};

function renderBoard(props: Partial<Parameters<typeof CompanyOsBoardView>[0]> = {}): string {
  return renderToStaticMarkup(
    <CompanyOsBoardView
      state={props.state ?? goldenBoard()}
      now={props.now ?? RENDER_NOW}
      isMobile={props.isMobile ?? false}
      collapsedLanes={props.collapsedLanes ?? new Set()}
      onToggleLane={props.onToggleLane ?? noop}
      onSetAllCollapsed={props.onSetAllCollapsed ?? noop}
      onRefresh={props.onRefresh ?? noop}
      refreshing={props.refreshing ?? false}
    />,
  );
}

describe("CompanyOsBoardView — populated", () => {
  const html = renderBoard();

  it("renders every lane (system × subsystem)", () => {
    for (const lane of ["Company-OS", "Coaching", "Reports", "Platform-infra"]) {
      expect(html).toContain(lane);
    }
  });

  it("renders chips across all four columns + the canonical column headers", () => {
    for (const col of ["Next up", "In progress", "In review", "Shipped"]) {
      expect(html).toContain(col);
    }
    for (const chip of ["COS-0", "MTP-04", "RE-22", "IMPRV-14", "MTP-07"]) {
      expect(html).toContain(chip);
    }
  });

  it("shows the cross-repo badge for an out-of-lane-home chip", () => {
    expect(html).toContain("arc-scraper");
  });

  it("flags the generic prefix as an anti-pattern (icon-only marker has an aria-label)", () => {
    expect(html).toContain("generic prefix — anti-pattern; prefer a specific family");
  });

  it("surfaces the stale source as a badge without blanking the board", () => {
    expect(html).toContain("pull-request");
    // The board still rendered its chips — a stale source is non-fatal.
    expect(html).toContain("MTP-03");
  });

  it("lists unclassified signals in the Ops lane with human reasons", () => {
    expect(html).toContain("unparseable branch");
    expect(html).toContain("unknown prefix");
    expect(html).toContain("claude/musing-burnell-8f4cb2");
  });

  it("injects the scoped motion stylesheet (incl. reduced-motion support) exactly once", () => {
    expect(html).toContain(`id="${BOARD_STYLE_ID}"`);
    expect(html).toContain("prefers-reduced-motion");
    expect(html.match(new RegExp(BOARD_STYLE_ID, "g"))?.length).toBe(1);
  });

  it("exposes a11y labels on the icon-only controls", () => {
    expect(html).toMatch(/aria-label="(Collapse|Expand) all lanes"/);
    expect(html).toMatch(/aria-label="Refresh the board"/);
  });
});

describe("CompanyOsBoardView — freshness", () => {
  it("fresh board shows a live freshness badge, not stale", () => {
    const html = renderBoard({ state: goldenBoard(NOW), now: NOW + 1000 });
    expect(html).toContain("Board is live");
    expect(html).not.toContain("Board is stale");
  });

  it("a board derived >5m ago shows the stale badge", () => {
    const html = renderBoard({ state: staleBoard(), now: NOW });
    expect(html).toContain("Board is stale");
    expect(html).toContain("· stale");
  });
});

describe("CompanyOsBoardView — collapse", () => {
  it("a collapsed lane hides its chips but keeps its header", () => {
    const board = goldenBoard();
    const allLaneIds = new Set(board.lanes.map((l) => l.id));
    const collapsed = renderBoard({ state: board, collapsedLanes: allLaneIds });
    expect(collapsed).toContain("Coaching"); // header stays
    expect(collapsed).not.toContain("MTP-04"); // body hidden
    // aria-expanded reflects the collapsed state.
    expect(collapsed).toContain('aria-expanded="false"');
  });

  it("an expanded lane shows aria-expanded=true + its chips", () => {
    const html = renderBoard({ collapsedLanes: new Set() });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("MTP-04");
  });
});

describe("CompanyOsBoardView — mobile", () => {
  it("stacks columns with per-column labels on mobile", () => {
    const html = renderBoard({ isMobile: true });
    expect(html).toContain("Next up ·");
    expect(html).toContain("MTP-04");
  });
});

describe("board non-data states", () => {
  it("LoadingState announces politely + has a labelled spinner", () => {
    const html = renderToStaticMarkup(<LoadingState />);
    expect(html).toContain("Loading the board");
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain("prefers-reduced-motion"); // spinner respects it
  });

  it("ErrorState shows the message + a retry control", () => {
    const html = renderToStaticMarkup(<ErrorState message="worker offline" onRetry={noop} />);
    expect(html).toContain("Couldn’t reach the worker");
    expect(html).toContain("worker offline");
    expect(html).toContain("Try again");
  });

  it("EmptyState explains the auto-fill + offers a manual derive", () => {
    const html = renderToStaticMarkup(<EmptyState onRefresh={noop} />);
    expect(html).toContain("No work on the board yet");
    expect(html).toContain("Derive now");
  });

  it("a barren board is empty (EmptyState path); a 0-chip taxonomy board is NOT (renders 0-count rows)", () => {
    expect(isBoardEmpty(barrenBoard())).toBe(true);
    expect(isBoardEmpty(zeroChipBoard())).toBe(false);
  });

  it("a 0-chip taxonomy board renders its lanes with 0-count cells (show the 0, don't hide it)", () => {
    const html = renderBoard({ state: zeroChipBoard(), collapsedLanes: new Set() });
    expect(html).toContain("Coaching"); // a registered lane renders
    expect(html).toContain("—"); // 0-count cells shown, not hidden
  });
});
