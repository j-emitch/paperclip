/**
 * SSR document renderer for the Playwright harness. Wraps the PURE board view
 * (and the non-data states) in a full HTML document with the host's dark theme
 * fallbacks, so Playwright can load a real, fully-styled board in Chromium with
 * NO running host and no auth. The board styles itself entirely with inline CSS
 * + a scoped `<style>` block, so the SSR markup is pixel-faithful to the live
 * render — the harness exercises the exact same component tree.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { CompanyOsBoardView } from "../../../src/ui/board/CompanyOsBoardView.js";
import { EmptyState, ErrorState, LoadingState } from "../../../src/ui/board/states.js";
import type { BoardStateV1 } from "../../../src/contracts/index.js";
import { goldenBoard, emptyBoard, staleBoard, RENDER_NOW } from "../fixtures/board.js";
import { NOW } from "../../fixtures/signals.js";

const noop = () => {};

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
    { name: "empty", width: 1180, html: document("Board · empty", renderToStaticMarkup(<EmptyState onRefresh={noop} />), 720) },
    { name: "loading", width: 1180, html: document("Board · loading", renderToStaticMarkup(<LoadingState />), 720) },
    { name: "error", width: 1180, html: document("Board · error", renderToStaticMarkup(<ErrorState message="The plugin worker did not respond." onRetry={noop} />), 720) },
  ];
}
