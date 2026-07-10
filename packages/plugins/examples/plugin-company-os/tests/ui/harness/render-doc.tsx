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
import { DocumentViewerPanel } from "../../../src/ui/shared/DocumentViewerPanel.js";
import { HomeView } from "../../../src/ui/home/HomeView.js";
import { BranchPrHealthView } from "../../../src/ui/branch-pr/BranchPrHealthView.js";
import { BranchRow } from "../../../src/ui/branch-pr/BranchRow.js";
import { DocsView } from "../../../src/ui/docs/DocsView.js";
import { AgentsView } from "../../../src/ui/agents/AgentsView.js";
import { BuildAtlasView } from "../../../src/ui/atlas/BuildAtlasView.js";
import { FamilyCard } from "../../../src/ui/atlas/FamilyCard.js";
import { SurfaceEmpty } from "../../../src/ui/shared/surface-state.js";
import { AtlasIcon } from "../../../src/ui/icons.js";
import { CockpitMotionStyles } from "../../../src/ui/shared/cockpit-motion.js";
import { TeachingView } from "../../../src/ui/teaching/TeachingView.js";
import { EMPTY_TEACHING_FILTER } from "../../../src/ui/teaching/teaching-view-model.js";
import type { BoardStateV1, TeachingOverviewV1 } from "../../../src/contracts/index.js";
import { goldenBoard, staleBoard, zeroChipBoard, RENDER_NOW } from "../fixtures/board.js";
import { okMarkdownContent } from "../fixtures/reports.js";
import { goldenOrientation, emptyOrientation, HOME_NOW } from "../fixtures/home.js";
import { goldenGitState, emptyGitState, BRANCH_PR_NOW } from "../fixtures/branch-pr.js";
import { goldenDocIndex, emptyDocIndex, dogfoodSpecDocId, DOCS_NOW } from "../fixtures/docs.js";
import { goldenAgentSystem, emptyAgentSystem, AGENTS_NOW } from "../fixtures/agents.js";
import { goldenAtlas, ATLAS_NOW } from "../fixtures/atlas.js";
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

function branchPr(isMobile: boolean, opts?: { empty?: boolean }): ReactElement {
  return <BranchPrHealthView gitState={opts?.empty ? emptyGitState() : goldenGitState()} now={BRANCH_PR_NOW} isMobile={isMobile} />;
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

function agents(isMobile: boolean, opts?: { empty?: boolean; selected?: string }): ReactElement {
  return (
    <AgentsView
      system={opts?.empty ? emptyAgentSystem() : goldenAgentSystem()}
      now={AGENTS_NOW}
      isMobile={isMobile}
      selectedAgentKey={opts?.selected ?? null}
      // The live app always wires selection, so the harness renders the interactive
      // form (real button roles) — the SSR harness has no hydration, so onSelect is a noop.
      onSelectAgent={noop}
    />
  );
}

function atlas(isMobile: boolean): ReactElement {
  return <BuildAtlasView atlas={goldenAtlas()} now={ATLAS_NOW} isMobile={isMobile} onRefresh={noop} refreshing={false} />;
}

function atlasStale(): ReactElement {
  return <BuildAtlasView atlas={goldenAtlas()} now={ATLAS_NOW + 10 * 60 * 1000} isMobile={false} onRefresh={noop} refreshing={false} />;
}

function atlasEmpty(): ReactElement {
  return (
    <SurfaceEmpty
      icon={<AtlasIcon size={24} />}
      title="No atlas yet"
      body="The cockpit hasn’t derived any families yet. The Build Atlas fills in automatically as specs, plans, branches, PRs, and merges land across the workspace."
      onRefresh={noop}
    />
  );
}

/** An expanded family card — the SSR harness has no hydration, so the open body
 *  (builds + tickets + lineage tags) is screenshotted via `defaultExpanded`. */
function atlasExpanded(): ReactElement {
  const family = goldenAtlas().families.find((f) => f.prefix === "COS");
  if (!family) throw new Error("harness: COS family missing from goldenAtlas");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <CockpitMotionStyles />
      <FamilyCard family={family} now={ATLAS_NOW} defaultExpanded />
    </div>
  );
}

/** A single expanded BranchRow — proves the open-PR detail + commit list render (the
 *  harness is SSR-only with no hydration, so an open row is screenshotted via
 *  `defaultExpanded`, not a click). Uses docs/COS-1 (a branch WITH an open PR). */
function branchPrExpandedBranch(): ReactElement {
  const branch = goldenGitState().groups[0].repos[0].branches[1]; // company/docs/COS-1, PR #361 + commits
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <CockpitMotionStyles />
      <BranchRow branch={branch} now={BRANCH_PR_NOW} defaultExpanded />
    </div>
  );
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
    { name: "home-desktop", width: 1180, html: document("Home · populated", renderToStaticMarkup(home(false)), 1180) },
    { name: "home-mobile", width: 390, html: document("Home · mobile", renderToStaticMarkup(home(true)), 390) },
    { name: "home-empty", width: 1180, html: document("Home · empty (all 0-states)", renderToStaticMarkup(home(false, { empty: true })), 1180) },
    { name: "home-drawer", width: 1180, html: document("Home · briefing drawer", renderToStaticMarkup(home(false, { drawer: true })), 1180) },
    { name: "branch-pr-desktop", width: 1180, html: document("Branch · PR Health · populated", renderToStaticMarkup(branchPr(false)), 1180) },
    { name: "branch-pr-mobile", width: 390, html: document("Branch · PR Health · mobile", renderToStaticMarkup(branchPr(true)), 390) },
    { name: "branch-pr-empty", width: 1180, html: document("Branch · PR Health · empty", renderToStaticMarkup(branchPr(false, { empty: true })), 1180) },
    { name: "branch-pr-expanded", width: 760, html: document("Branch · PR Health · expanded branch", renderToStaticMarkup(branchPrExpandedBranch()), 760) },
    { name: "docs-desktop", width: 1180, html: document("Docs · populated", renderToStaticMarkup(docs(false)), 1180) },
    { name: "docs-mobile", width: 390, html: document("Docs · mobile", renderToStaticMarkup(docs(true)), 390) },
    { name: "docs-empty", width: 1180, html: document("Docs · empty", renderToStaticMarkup(docs(false, { empty: true })), 1180) },
    { name: "docs-selected", width: 1180, html: document("Docs · doc open", renderToStaticMarkup(docs(false, { selected: true })), 1180) },
    { name: "agents-desktop", width: 1180, html: document("Agents · populated", renderToStaticMarkup(agents(false)), 1180) },
    { name: "agents-mobile", width: 390, html: document("Agents · mobile", renderToStaticMarkup(agents(true)), 390) },
    { name: "agents-empty", width: 1180, html: document("Agents · empty (all 0-states)", renderToStaticMarkup(agents(false, { empty: true })), 1180) },
    { name: "agents-selected", width: 1180, html: document("Agents · CTO selected", renderToStaticMarkup(agents(false, { selected: "cto" })), 1180) },
    { name: "atlas-desktop", width: 1180, html: document("Atlas · populated", renderToStaticMarkup(atlas(false)), 1180) },
    { name: "atlas-mobile", width: 390, html: document("Atlas · mobile", renderToStaticMarkup(atlas(true)), 390) },
    { name: "atlas-stale", width: 1180, html: document("Atlas · stale", renderToStaticMarkup(atlasStale()), 1180) },
    { name: "atlas-empty", width: 1180, html: document("Atlas · empty", renderToStaticMarkup(atlasEmpty()), 720) },
    { name: "atlas-expanded", width: 760, html: document("Atlas · expanded family", renderToStaticMarkup(atlasExpanded()), 760) },
    { name: "teaching-desktop", width: 1180, html: document("Teaching · stalled loop", renderToStaticMarkup(teaching(goldenTeachingOverview(), false)), 1180) },
    { name: "teaching-mobile", width: 390, html: document("Teaching · mobile", renderToStaticMarkup(teaching(goldenTeachingOverview(), true)), 390) },
    { name: "teaching-healthy", width: 1180, html: document("Teaching · healthy loop", renderToStaticMarkup(teaching(healthyTeachingOverview(), false)), 1180) },
  ];
}
