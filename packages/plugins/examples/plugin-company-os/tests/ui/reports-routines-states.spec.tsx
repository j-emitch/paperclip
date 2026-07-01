/**
 * SSR state-injection for the Reports + Routines surfaces. Renders the PURE views
 * + the viewer states with `renderToStaticMarkup` (no host bridge, no DOM) and
 * asserts they don't throw and surface their key content. This is the same
 * bridge-free guarantee the board relies on, and it's what lets the Playwright
 * harness screenshot the exact live tree. The markdown body is injected as a
 * `<pre>` slot here (production injects the host `<MarkdownBlock>`).
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { ReportsView } from "../../src/ui/reports/ReportsView.js";
import { DocumentViewerPanel } from "../../src/ui/shared/DocumentViewerPanel.js";
import { RoutinesView } from "../../src/ui/routines/RoutinesView.js";
import { EMPTY_FILTER } from "../../src/ui/reports/reports-view-model.js";
import {
  goldenArtifactIndex,
  goldenRoutineHealth,
  emptyArtifactIndex,
  okMarkdownContent,
  tooLargeContent,
  REPORTS_NOW,
} from "./fixtures/reports.js";

const noop = () => {};
const pre = (md: string): ReactNode => <pre data-testid="md">{md}</pre>;

function viewerPanel(content: Parameters<typeof DocumentViewerPanel>[0]["content"]) {
  return renderToStaticMarkup(
    <DocumentViewerPanel content={content} loading={false} error={null} now={REPORTS_NOW} renderMarkdown={pre} />,
  );
}

describe("Reports SSR", () => {
  it("renders the populated index + filters + the markdown viewer", () => {
    const html = renderToStaticMarkup(
      <ReportsView
        index={goldenArtifactIndex()}
        filter={EMPTY_FILTER}
        onFilterChange={noop}
        selectedKey={null}
        onSelect={noop}
        now={REPORTS_NOW}
        viewer={<DocumentViewerPanel content={okMarkdownContent()} loading={false} error={null} now={REPORTS_NOW} renderMarkdown={pre} />}
      />,
    );
    expect(html).toContain("Reports");
    expect(html).toContain("COS-0 — Company OS Dev Cockpit"); // a doc title in the list + viewer
    expect(html).toContain("Search titles"); // the search box
    expect(html).toContain("aria-label=\"Filter by type\"");
    expect(html).toContain("A first-party Paperclip plugin"); // the markdown body slot rendered
  });

  it("renders the empty workspace as an explicit no-match list, not a crash", () => {
    const html = renderToStaticMarkup(
      <ReportsView index={emptyArtifactIndex()} filter={EMPTY_FILTER} onFilterChange={noop} selectedKey={null} onSelect={noop} now={REPORTS_NOW} viewer={null} />,
    );
    expect(html).toContain("No reports match these filters.");
  });

  it("viewer: ok markdown renders the body (frontmatter stripped) + header metadata", () => {
    const html = viewerPanel(okMarkdownContent());
    expect(html).toContain("Specs"); // type pill
    expect(html).toContain("approved"); // docStatus pill
    expect(html).toContain("company"); // repo badge
    expect(html).toContain("A first-party Paperclip plugin"); // the body
    // The leading YAML frontmatter is NOT rendered as body text.
    expect(html).not.toContain("type: spec");
  });

  it("viewer: too-large renders the typed safety notice, never the bytes", () => {
    const html = viewerPanel(tooLargeContent());
    expect(html).toContain("too large");
    expect(html).toContain("open it in your editor");
  });

  it("viewer: nothing-selected renders the placeholder", () => {
    const html = viewerPanel(null);
    expect(html).toContain("Pick a report to read");
  });

  it("viewer: a bridge error renders a retry affordance", () => {
    const html = renderToStaticMarkup(
      <DocumentViewerPanel content={null} loading={false} error="worker offline" now={REPORTS_NOW} renderMarkdown={pre} onRetry={noop} />,
    );
    expect(html).toContain("Couldn’t load the document");
    expect(html).toContain("Try again");
  });
});

describe("Routines SSR", () => {
  it("renders every agent group + the verdict summary", () => {
    const html = renderToStaticMarkup(<RoutinesView health={goldenRoutineHealth()} now={REPORTS_NOW} />);
    expect(html).toContain("Routines");
    for (const agent of ["CEO", "COO", "CTO", "Librarian"]) expect(html).toContain(agent);
    // The summary tallies + a routine card verdict.
    expect(html).toContain("fresh");
    expect(html).toContain("missing");
    expect(html).toContain("Daily Standup");
  });

  it("renders an empty health snapshot without throwing", () => {
    const empty = { ...goldenRoutineHealth(), routines: [] };
    const html = renderToStaticMarkup(<RoutinesView health={empty} now={REPORTS_NOW} />);
    expect(html).toContain("No routine contracts found yet");
  });
});
