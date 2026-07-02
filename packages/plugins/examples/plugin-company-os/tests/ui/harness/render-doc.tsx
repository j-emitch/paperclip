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
import { ReportViewerPanel } from "../../../src/ui/reports/ReportViewerPanel.js";
import { RoutinesView } from "../../../src/ui/routines/RoutinesView.js";
import { TeachingView } from "../../../src/ui/teaching/TeachingView.js";
import { EMPTY_FILTER } from "../../../src/ui/reports/reports-view-model.js";
import { EMPTY_TEACHING_FILTER } from "../../../src/ui/teaching/teaching-view-model.js";
import type { BoardStateV1, TeachingOverviewV1 } from "../../../src/contracts/index.js";
import { goldenBoard, staleBoard, zeroChipBoard, RENDER_NOW } from "../fixtures/board.js";
import { goldenArtifactIndex, goldenRoutineHealth, okMarkdownContent, REPORTS_NOW } from "../fixtures/reports.js";
import { goldenTeachingOverview, healthyTeachingOverview, TEACHING_NOW } from "../fixtures/teaching.js";
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
      viewer={<ReportViewerPanel content={okMarkdownContent()} loading={false} error={null} now={REPORTS_NOW} isMobile={isMobile} renderMarkdown={preMarkdown} />}
    />
  );
}

function routines(isMobile: boolean): ReactElement {
  return <RoutinesView health={goldenRoutineHealth()} now={REPORTS_NOW} isMobile={isMobile} />;
}

function teaching(overview: TeachingOverviewV1, isMobile: boolean): ReactElement {
  return <TeachingView overview={overview} filter={EMPTY_TEACHING_FILTER} onFilterChange={noop} now={TEACHING_NOW} isMobile={isMobile} />;
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
    { name: "teaching-desktop", width: 1180, html: document("Teaching · stalled loop", renderToStaticMarkup(teaching(goldenTeachingOverview(), false)), 1180) },
    { name: "teaching-mobile", width: 390, html: document("Teaching · mobile", renderToStaticMarkup(teaching(goldenTeachingOverview(), true)), 390) },
    { name: "teaching-healthy", width: 1180, html: document("Teaching · healthy loop", renderToStaticMarkup(teaching(healthyTeachingOverview(), false)), 1180) },
  ];
}
