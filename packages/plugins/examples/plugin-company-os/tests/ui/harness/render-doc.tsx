/**
 * SSR document renderer for the Playwright harness. Wraps the PURE board view
 * (and the non-data states) in a full HTML document with the host's dark theme
 * fallbacks, so Playwright can load a real, fully-styled board in Chromium with
 * NO running host and no auth. The board styles itself entirely with inline CSS
 * + a scoped `<style>` block, so the SSR markup is pixel-faithful to the live
 * render — the harness exercises the exact same component tree.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { CompanyOsBoardView } from "../../../src/ui/board/CompanyOsBoardView.js";
import { EmptyState, ErrorState, LoadingState } from "../../../src/ui/board/states.js";
import { ReportsView } from "../../../src/ui/reports/ReportsView.js";
import { DocumentViewerPanel } from "../../../src/ui/shared/DocumentViewerPanel.js";
import { RoutinesView } from "../../../src/ui/routines/RoutinesView.js";
import { HomeView } from "../../../src/ui/home/HomeView.js";
import { SourceView } from "../../../src/ui/source/SourceView.js";
import { BranchRow } from "../../../src/ui/source/BranchRow.js";
import { DocsView } from "../../../src/ui/docs/DocsView.js";
import { CockpitMotionStyles } from "../../../src/ui/shared/cockpit-motion.js";
import { EMPTY_FILTER } from "../../../src/ui/reports/reports-view-model.js";
import type { BoardStateV1 } from "../../../src/contracts/index.js";
import { goldenBoard, staleBoard, zeroChipBoard, RENDER_NOW } from "../fixtures/board.js";
import { goldenArtifactIndex, goldenRoutineHealth, okMarkdownContent, REPORTS_NOW } from "../fixtures/reports.js";
import { goldenOrientation, emptyOrientation, HOME_NOW } from "../fixtures/home.js";
import { goldenGitState, emptyGitState, SOURCE_NOW } from "../fixtures/source.js";
import { goldenDocIndex, emptyDocIndex, dogfoodSpecDocId, DOCS_NOW } from "../fixtures/docs.js";
import { NOW } from "../../fixtures/signals.js";

const noop = () => {};
/** The harness markdown slot — a styled `<pre>` (production injects the host MarkdownBlock). */
const preMarkdown = (md: string): ReactNode => <pre>{md}</pre>;

function document(title: string, bodyMarkup: string, width: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; }
  body {
    background: oklch(0.145 0 0);
    color: oklch(0.985 0 0);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
  }
  #cos-harness-root { max-width: ${width}px; margin: 0 auto; }
</style>
</head>
<body>
<div id="cos-harness-root">${bodyMarkup}</div>
</body>
</html>`;
}

function board(state: BoardStateV1, now: number, isMobile: boolean): ReactElement {
  return (
    <CompanyOsBoardView
      state={state}
      now={now}
      isMobile={isMobile}
      collapsedLanes={new Set()}
      onToggleLane={noop}
      onSetAllCollapsed={noop}
      onRefresh={noop}
      refreshing={false}
    />
  );
}

function reports(isMobile: boolean): ReactElement {
  return (
    <ReportsView
      index={goldenArtifactIndex()}
      filter={EMPTY_FILTER}
      onFilterChange={noop}
      selectedKey={null}
      onSelect={noop}
      now={REPORTS_NOW}
      isMobile={isMobile}
      viewer={<DocumentViewerPanel content={okMarkdownContent()} loading={false} error={null} now={REPORTS_NOW} isMobile={isMobile} renderMarkdown={preMarkdown} />}
    />
  );
}

function routines(isMobile: boolean): ReactElement {
  return <RoutinesView health={goldenRoutineHealth()} now={REPORTS_NOW} isMobile={isMobile} />;
}

function home(isMobile: boolean, opts?: { empty?: boolean; drawer?: boolean }): ReactElement {
  const drawer = opts?.drawer ? (
    <DocumentViewerPanel content={okMarkdownContent()} loading={false} error={null} now={HOME_NOW} isMobile={isMobile} renderMarkdown={preMarkdown} />
  ) : undefined;
  return (
    <HomeView
      orientation={opts?.empty ? emptyOrientation() : goldenOrientation()}
      now={HOME_NOW}
      isMobile={isMobile}
      onOpenBriefing={noop}
      onFollow={noop}
      onNavigateTab={noop}
      drawer={drawer}
      drawerTitle={opts?.drawer ? "Daily Standup — what moved overnight" : null}
      onCloseDrawer={opts?.drawer ? noop : undefined}
    />
  );
}

function source(isMobile: boolean, opts?: { empty?: boolean }): ReactElement {
  return <SourceView gitState={opts?.empty ? emptyGitState() : goldenGitState()} now={SOURCE_NOW} isMobile={isMobile} />;
}

function docs(isMobile: boolean, opts?: { empty?: boolean; selected?: boolean }): ReactElement {
  const selectedDocId = opts?.selected ? dogfoodSpecDocId() : null;
  const viewer = opts?.selected ? (
    <DocumentViewerPanel content={okMarkdownContent()} loading={false} error={null} now={DOCS_NOW} isMobile={isMobile} renderMarkdown={preMarkdown} typeLabel="Spec" />
  ) : (
    <DocumentViewerPanel content={null} loading={false} error={null} now={DOCS_NOW} isMobile={isMobile} renderMarkdown={preMarkdown} />
  );
  return (
    <DocsView
      docIndex={opts?.empty ? emptyDocIndex() : goldenDocIndex()}
      selectedDocId={selectedDocId}
      onSelect={noop}
      now={DOCS_NOW}
      isMobile={isMobile}
      viewer={viewer}
    />
  );
}

/** A single expanded BranchRow — proves the commit list renders (the harness is
 *  SSR-only with no hydration, so an open row is screenshotted via `defaultExpanded`,
 *  not a click). */
function sourceExpandedBranch(): ReactElement {
  const branch = goldenGitState().groups[0].repos[0].branches[0]; // company/main, has commits
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <CockpitMotionStyles />
      <BranchRow branch={branch} now={SOURCE_NOW} defaultExpanded />
    </div>
  );
}

export interface HarnessDoc {
  name: string;
  width: number;
  html: string;
}

/** All harness documents — one per board state × the two desktop/mobile widths where relevant. */
export function harnessDocs(): HarnessDoc[] {
  return [
    { name: "populated-desktop", width: 1180, html: document("Board · populated", renderToStaticMarkup(board(goldenBoard(), RENDER_NOW, false)), 1180) },
    { name: "populated-mobile", width: 390, html: document("Board · populated · mobile", renderToStaticMarkup(board(goldenBoard(), RENDER_NOW, true)), 390) },
    { name: "stale", width: 1180, html: document("Board · stale", renderToStaticMarkup(board(staleBoard(), NOW, false)), 1180) },
    { name: "zero-count", width: 1180, html: document("Board · zero-count rows", renderToStaticMarkup(board(zeroChipBoard(), RENDER_NOW, false)), 1180) },
    { name: "empty", width: 1180, html: document("Board · empty", renderToStaticMarkup(<EmptyState onRefresh={noop} />), 720) },
    { name: "loading", width: 1180, html: document("Board · loading", renderToStaticMarkup(<LoadingState />), 720) },
    { name: "error", width: 1180, html: document("Board · error", renderToStaticMarkup(<ErrorState message="The plugin worker did not respond." onRetry={noop} />), 720) },
    { name: "reports-desktop", width: 1180, html: document("Reports · populated", renderToStaticMarkup(reports(false)), 1180) },
    { name: "reports-mobile", width: 390, html: document("Reports · mobile", renderToStaticMarkup(reports(true)), 390) },
    { name: "routines-desktop", width: 1180, html: document("Routines · populated", renderToStaticMarkup(routines(false)), 1180) },
    { name: "routines-mobile", width: 390, html: document("Routines · mobile", renderToStaticMarkup(routines(true)), 390) },
    { name: "home-desktop", width: 1180, html: document("Home · populated", renderToStaticMarkup(home(false)), 1180) },
    { name: "home-mobile", width: 390, html: document("Home · mobile", renderToStaticMarkup(home(true)), 390) },
    { name: "home-empty", width: 1180, html: document("Home · empty (all 0-states)", renderToStaticMarkup(home(false, { empty: true })), 1180) },
    { name: "home-drawer", width: 1180, html: document("Home · briefing drawer", renderToStaticMarkup(home(false, { drawer: true })), 1180) },
    { name: "source-desktop", width: 1180, html: document("Source · populated", renderToStaticMarkup(source(false)), 1180) },
    { name: "source-mobile", width: 390, html: document("Source · mobile", renderToStaticMarkup(source(true)), 390) },
    { name: "source-empty", width: 1180, html: document("Source · empty", renderToStaticMarkup(source(false, { empty: true })), 1180) },
    { name: "source-expanded", width: 760, html: document("Source · expanded branch", renderToStaticMarkup(sourceExpandedBranch()), 760) },
    { name: "docs-desktop", width: 1180, html: document("Docs · populated", renderToStaticMarkup(docs(false)), 1180) },
    { name: "docs-mobile", width: 390, html: document("Docs · mobile", renderToStaticMarkup(docs(true)), 390) },
    { name: "docs-empty", width: 1180, html: document("Docs · empty", renderToStaticMarkup(docs(false, { empty: true })), 1180) },
    { name: "docs-selected", width: 1180, html: document("Docs · doc open", renderToStaticMarkup(docs(false, { selected: true })), 1180) },
  ];
}
