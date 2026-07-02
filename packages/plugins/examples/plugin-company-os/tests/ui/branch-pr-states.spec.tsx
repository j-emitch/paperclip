/**
 * SSR state-injection for the Branch · PR Health surface (COS-5e). Renders the PURE
 * `BranchPrHealthView` (+ an expanded / collapsed `BranchRow`) with
 * `renderToStaticMarkup` (no host bridge, no DOM) and asserts the project-grouped
 * branch tree, the dependency + absent-repo rows, the comparison/status chips, the
 * expanded commit list, AND the COS-5e enrichment — PR lifecycle cues, review verdict
 * pills (text, never color-only), the attention band, the review-flagged callout,
 * orphan PRs, and the local-ahead note — all surface without throwing. Plus unit
 * coverage of the pure `buildBranchPrView` view-model.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchPrHealthView } from "../../src/ui/branch-pr/BranchPrHealthView.js";
import { BranchRow } from "../../src/ui/branch-pr/BranchRow.js";
import { buildBranchPrView, isBranchPrEmpty } from "../../src/ui/branch-pr/branch-pr-view-model.js";
import { goldenGitState, emptyGitState, BRANCH_PR_NOW } from "./fixtures/branch-pr.js";

describe("Branch · PR Health SSR", () => {
  it("renders the project-grouped branch tree from the golden git state", () => {
    const html = renderToStaticMarkup(<BranchPrHealthView gitState={goldenGitState()} now={BRANCH_PR_NOW} />);
    expect(html).toContain("Branch · PR Health");
    // Project headers
    expect(html).toContain("Company");
    expect(html).toContain("Juice Bar");
    // Repos + roles
    expect(html).toContain("arc-scraper");
    expect(html).toContain("dependency");
    // Branches + their states
    expect(html).toContain("main");
    expect(html).toContain("claude/SSF-04/reconciliation-rehaul");
    expect(html).toContain("conflicts");
    expect(html).toContain("behind");
    expect(html).toContain("no merge base"); // arc-scraper comparison-unavailable label
    // Absent repo renders an honest 0-row, never vanishes
    expect(html).toContain("Viacava Arts");
    expect(html).toContain("not found on disk");
    // Honest degradation pill (repo-distinguished)
    expect(html).toContain("branch · viacava-arts stale");
  });

  it("surfaces PR lifecycle + review verdicts (text, not color-only)", () => {
    const html = renderToStaticMarkup(<BranchPrHealthView gitState={goldenGitState()} now={BRANCH_PR_NOW} />);
    // PR numbers on their branches
    expect(html).toContain("#361");
    expect(html).toContain("#372");
    // Lifecycle markers
    expect(html).toContain("draft"); // #372 is a draft
    expect(html).toContain("open"); // #361 is open
    // Verdict labels are TEXT (a11y: color-not-only) — ship + no-ship both present
    expect(html).toContain("ship");
    expect(html).toContain("no-ship");
  });

  it("renders the attention band + the review-flagged callout with matching counts", () => {
    const html = renderToStaticMarkup(<BranchPrHealthView gitState={goldenGitState()} now={BRANCH_PR_NOW} />);
    // Attention band: SSF-04 (conflicting=high) + docs/COS-1 (dirty) + arc mtpfeed (stale) = 3
    expect(html).toContain("Needs attention");
    expect(html).toContain("At risk"); // the high-severity label (SSF-04)
    // Second health axis — the blocking review on #372
    expect(html).toContain("Flagged by review");
  });

  it("surfaces orphan PRs (no local branch) with their head ref, never dropped", () => {
    const html = renderToStaticMarkup(<BranchPrHealthView gitState={goldenGitState()} now={BRANCH_PR_NOW} />);
    expect(html).toContain("PRs without a local branch");
    expect(html).toContain("#359");
    expect(html).toContain("cron/RE-30"); // the orphan PR's head ref is shown
  });

  it("renders the empty git state as a calm 0-state, never a crash", () => {
    const html = renderToStaticMarkup(<BranchPrHealthView gitState={emptyGitState()} now={BRANCH_PR_NOW} />);
    expect(html).toContain("Branch · PR Health");
    expect(html).toContain("No repositories are configured yet");
  });

  it("an expanded BranchRow reveals its open PR detail + recent commits", () => {
    const branch = goldenGitState().groups[0].repos[0].branches[1]; // company/docs/COS-1 (has PR #361)
    const html = renderToStaticMarkup(<BranchRow branch={branch} now={BRANCH_PR_NOW} defaultExpanded />);
    // PR detail
    expect(html).toContain("#361");
    expect(html).toContain("daily-driver cockpit");
    expect(html).toContain("P2 2"); // p2 finding count
    // Commits
    expect(html).toContain("f96d4ce"); // short sha
    expect(html).toContain("§16 reconciliation");
  });

  it("shows the 'local ahead of PR head' note when the branch tip is past the PR head", () => {
    const branch = goldenGitState().groups[1].repos[0].branches[1]; // juice-bar PERF-02 (tip ahead of PR head)
    const html = renderToStaticMarkup(<BranchRow branch={branch} now={BRANCH_PR_NOW} defaultExpanded />);
    expect(html).toContain("#350");
    expect(html).toContain("local ahead of PR head");
  });

  it("a collapsed BranchRow shows the header state + PR cue but hides the detail", () => {
    const branch = goldenGitState().groups[1].repos[0].branches[0]; // juice-bar SSF-04
    const html = renderToStaticMarkup(<BranchRow branch={branch} now={BRANCH_PR_NOW} />);
    expect(html).toContain("claude/SSF-04/reconciliation-rehaul");
    expect(html).toContain("conflicts");
    expect(html).toContain("↑2 ↓14");
    expect(html).toContain("#372"); // PR cue in the header
    expect(html).toContain("draft");
    expect(html).not.toContain("forward-compat seam"); // commit subject hidden while collapsed
  });
});

describe("buildBranchPrView", () => {
  it("computes vitals from the golden git state", () => {
    const view = buildBranchPrView(goldenGitState());
    expect(view.vitals.repoCount).toBe(3); // company + juice-bar + arc-scraper (viacava missing, excluded)
    expect(view.vitals.branchCount).toBe(5); // 2 + 2 + 1
    expect(view.vitals.openPrCount).toBe(4); // 3 attached + 1 orphan
    expect(view.vitals.reviewedPrCount).toBe(2); // #361 ship + #372 no-ship (both head-current)
    expect(view.vitals.needsAttentionCount).toBe(3); // SSF-04 + docs/COS-1 + arc mtpfeed
    expect(view.vitals.orphanPrCount).toBe(1);
  });

  it("orders the attention band worst-severity-first", () => {
    const view = buildBranchPrView(goldenGitState());
    expect(view.attention).toHaveLength(3);
    expect(view.attention[0].branch).toBe("claude/SSF-04/reconciliation-rehaul"); // high (conflicting)
    expect(view.attention[0].severity).toBe("high");
    // the remaining two are medium
    expect(view.attention.slice(1).every((r) => r.severity === "medium")).toBe(true);
  });

  it("flags only PRs whose CURRENT review is blocking/revise", () => {
    const view = buildBranchPrView(goldenGitState());
    expect(view.flaggedReviews).toHaveLength(1);
    expect(view.flaggedReviews[0].pr.prNumber).toBe(372);
    expect(view.flaggedReviews[0].pr.review?.verdict).toBe("block");
  });

  it("isBranchPrEmpty is true only when no repo produced a row", () => {
    expect(isBranchPrEmpty(emptyGitState())).toBe(true);
    expect(isBranchPrEmpty(goldenGitState())).toBe(false);
  });
});
