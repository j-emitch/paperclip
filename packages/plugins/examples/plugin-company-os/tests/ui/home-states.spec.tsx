/**
 * SSR state-injection for the Home (Orientation) surface. Renders the PURE
 * `HomeView` + every panel's populated and empty state with `renderToStaticMarkup`
 * (no host bridge, no DOM) and asserts they don't throw and surface their key
 * content + their calm 0-states. This is the same bridge-free guarantee the board
 * relies on, and it's what lets the Playwright harness screenshot the exact live
 * tree.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../../src/ui/home/HomeView.js";
import { groupByProject, sortByHealth } from "../../src/ui/home/home-view-model.js";
import { goldenOrientation, emptyOrientation, HOME_NOW } from "./fixtures/home.js";

describe("Home SSR", () => {
  it("renders every panel from the golden orientation", () => {
    const html = renderToStaticMarkup(<HomeView orientation={goldenOrientation()} now={HOME_NOW} />);
    expect(html).toContain("Orientation");
    // Briefing + verdict
    expect(html).toContain("Daily Standup");
    expect(html).toContain("CEO");
    // Metrics strip values + a label
    expect(html).toContain("In progress");
    expect(html).toContain("Branches at risk");
    // Branch health — slimmed to a one-line alert link into Branch · PR Health (COS-5e);
    // the full per-branch detail moved to that tab. 2 juice-bar rows in the fixture.
    expect(html).toContain("2 branches need attention");
    // Recent commits — short sha + subject
    expect(html).toContain("44edce3"); // 7-char short sha
    expect(html).toContain("add User Roles");
    // Cross-session work
    expect(html).toContain("SSF-04 reconciliation rehaul");
    // Alerts rail
    expect(html).toContain("Needs attention");
    expect(html).toContain("SSF-04 branch conflicts with main");
    // Honest degradation — a stale source pill in the header (repo-distinguished)
    expect(html).toContain("pull-request · juice-bar stale");
  });

  it("renders every calm 0-state from the empty orientation (show-0-counts, never a crash)", () => {
    const html = renderToStaticMarkup(<HomeView orientation={emptyOrientation()} now={HOME_NOW} />);
    expect(html).toContain("Orientation");
    expect(html).toContain("All branches healthy"); // BranchHealthPanel 0-state
    expect(html).toContain("all clear"); // AlertsRail 0-state ("You're all clear")
    expect(html).toContain("No routine briefings pinned yet"); // PinnedBriefing 0-state
    expect(html).toContain("No cross-session work has moved recently"); // CrossSessionWork 0-state
    expect(html).toContain("No commits in the recent window"); // RecentCommitsGlance 0-state
    // The vitals strip still renders its zeroes, not a hidden panel.
    expect(html).toContain("In progress");
  });

  it("renders the briefing drawer overlay when the drawer slot is filled", () => {
    const html = renderToStaticMarkup(
      <HomeView
        orientation={goldenOrientation()}
        now={HOME_NOW}
        drawer={<div data-testid="viewer">briefing-body</div>}
        drawerTitle="Daily Standup"
        onCloseDrawer={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("briefing-body");
    expect(html).toContain("Close briefing");
  });

  it("mobile layout renders the same panels without throwing", () => {
    const html = renderToStaticMarkup(<HomeView orientation={goldenOrientation()} now={HOME_NOW} isMobile />);
    expect(html).toContain("Orientation");
    expect(html).toContain("SSF-04 branch conflicts with main");
  });
});

describe("home-view-model", () => {
  it("groupByProject buckets items in taxonomy order, dropping empty families", () => {
    const o = goldenOrientation();
    const grouped = groupByProject(o.taxonomy, o.branchHealth);
    // Both branch-health rows are juice-bar → exactly one group, no empty company/viacava/paperclip rows.
    expect(grouped).toHaveLength(1);
    expect(grouped[0].group.key).toBe("juice-bar");
    expect(grouped[0].items).toHaveLength(2);
  });

  it("sortByHealth orders worst-severity-first then most-behind", () => {
    const o = goldenOrientation();
    const sorted = sortByHealth(o.branchHealth);
    expect(sorted[0].severity).toBe("high");
    expect(sorted[1].severity).toBe("medium");
  });

  it("groupByProject returns nothing for an empty slice", () => {
    const o = emptyOrientation();
    expect(groupByProject(o.taxonomy, o.branchHealth)).toHaveLength(0);
  });
});

describe("Home diagnostics strip (B2)", () => {
  const diag = (level: "error" | "warn" | "info", code: string) => ({
    level,
    code,
    message: `${code} happened`,
    repo: "juice-bar",
    source: "branch",
  });

  it("renders derive diagnostics worst-first under the snapshot", () => {
    const o = { ...goldenOrientation(), diagnostics: [diag("info", "conflict_check_capped"), diag("error", "cache_write_failed"), diag("warn", "git_budget_exceeded")] };
    const html = renderToStaticMarkup(<HomeView orientation={o} now={HOME_NOW} />);
    expect(html).toContain("cache_write_failed");
    expect(html).toContain("git_budget_exceeded");
    // Worst-first: the error row precedes the warn row precedes the info row.
    expect(html.indexOf("cache_write_failed")).toBeLessThan(html.indexOf("git_budget_exceeded"));
    expect(html.indexOf("git_budget_exceeded")).toBeLessThan(html.indexOf("conflict_check_capped"));
    expect(html).not.toContain("more diagnostic"); // 3 rows fit the strip
  });

  it("collapses past three rows behind an SSR-faithful details summary", () => {
    const o = {
      ...goldenOrientation(),
      diagnostics: [diag("error", "e1"), diag("warn", "w1"), diag("warn", "w2"), diag("info", "i1"), diag("info", "i2")],
    };
    const html = renderToStaticMarkup(<HomeView orientation={o} now={HOME_NOW} />);
    expect(html).toContain("2 more diagnostics");
    expect(html).toContain("i2 happened"); // overflow rows still in the tree (details body)
  });

  it("shows the calm all-clear line when the derive was clean (show the 0)", () => {
    const o = { ...goldenOrientation(), diagnostics: [] };
    const html = renderToStaticMarkup(<HomeView orientation={o} now={HOME_NOW} />);
    expect(html).toContain("No derive diagnostics");
  });
});
