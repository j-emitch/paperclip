/**
 * SSR state-injection for the Source surface. Renders the PURE `SourceView` (+ an
 * expanded `BranchRow`) with `renderToStaticMarkup` (no host bridge, no DOM) and
 * asserts the project-grouped branch tree, the dependency + absent-repo rows, the
 * comparison/status chips, and the expanded commit list all surface their content
 * without throwing.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceView } from "../../src/ui/source/SourceView.js";
import { BranchRow } from "../../src/ui/source/BranchRow.js";
import { goldenGitState, emptyGitState, SOURCE_NOW } from "./fixtures/source.js";

describe("Source SSR", () => {
  it("renders the project-grouped branch tree from the golden git state", () => {
    const html = renderToStaticMarkup(<SourceView gitState={goldenGitState()} now={SOURCE_NOW} />);
    expect(html).toContain("Source");
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
    expect(html).toContain("in sync"); // company/main
    expect(html).toContain("no merge base"); // arc-scraper comparison-unavailable label
    // Per-worktree dirty badge
    expect(html).toContain("7 dirty");
    // Absent repo renders an honest 0-row, never vanishes
    expect(html).toContain("Viacava Arts");
    expect(html).toContain("not found on disk");
    // Honest degradation pill (repo-distinguished)
    expect(html).toContain("branch · viacava-arts stale");
  });

  it("renders the empty git state as a calm 0-state, never a crash", () => {
    const html = renderToStaticMarkup(<SourceView gitState={emptyGitState()} now={SOURCE_NOW} />);
    expect(html).toContain("Source");
    expect(html).toContain("No repositories are configured yet");
  });

  it("an expanded BranchRow reveals its recent commits with shortstat", () => {
    const branch = goldenGitState().groups[0].repos[0].branches[0]; // company/main
    const html = renderToStaticMarkup(<BranchRow branch={branch} now={SOURCE_NOW} defaultExpanded />);
    expect(html).toContain("928bdb5"); // short sha
    expect(html).toContain("ship the company-os cockpit");
    expect(html).toContain("34f"); // files changed shortstat
    expect(html).toContain("+2841");
  });

  it("a collapsed BranchRow hides its commits but shows the header state", () => {
    const branch = goldenGitState().groups[1].repos[0].branches[0]; // juice-bar SSF-04
    const html = renderToStaticMarkup(<BranchRow branch={branch} now={SOURCE_NOW} />);
    expect(html).toContain("claude/SSF-04/reconciliation-rehaul");
    expect(html).toContain("conflicts");
    expect(html).toContain("↑2 ↓14");
    expect(html).not.toContain("forward-compat seam"); // commit subject hidden while collapsed
  });
});
