/**
 * Pure composite for the Docs tab: a header (count + freshness), the project →
 * type → doc `DocTree`, and the detail viewer. The viewer is injected as a NODE
 * so this stays bridge-free + SSR-screenshottable — production passes the
 * data-connected viewer (host `<MarkdownBlock>`), the harness passes a pure
 * `<ReportViewerPanel>` fed a `<pre>` renderer.
 *
 * Layout mirrors Reports: desktop = tree + viewer side-by-side; mobile = the tree
 * until a doc is selected, then the viewer full-width (its back control clears it).
 */

import type { ReactNode } from "react";
import type { DocIndexV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { StaleSourcePills, SurfaceFreshnessBadge } from "../shared/freshness.js";
import { DocTree, type DocSelection } from "./DocTree.js";

export interface DocsViewProps {
  docIndex: DocIndexV1;
  selectedDocId: string | null;
  onSelect: (selection: DocSelection) => void;
  now: number;
  isMobile?: boolean;
  /** The detail pane — connected viewer (live) or a pure one (harness). */
  viewer: ReactNode;
  /** Optional facet row (the COS-8f checkout filter), rendered under the header. */
  facetBar?: ReactNode;
  /**
   * A URL route issue (miss/ambiguity panel) is occupying the viewer pane —
   * the mobile layout must show it even though nothing is SELECTED, or a
   * broken deep-link silently renders the plain tree (found live 2026-07-08).
   */
  hasRouteIssue?: boolean;
}

function totalDocs(docIndex: DocIndexV1): number {
  return docIndex.groups.reduce((sum, s) => sum + s.types.reduce((t, b) => t + b.docs.length, 0), 0);
}

export function DocsView({ docIndex, selectedDocId, onSelect, now, isMobile = false, viewer, facetBar, hasRouteIssue = false }: DocsViewProps) {
  const total = totalDocs(docIndex);
  const showViewerOnly = isMobile && (selectedDocId !== null || hasRouteIssue);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      {!showViewerOnly ? (
        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Docs</h2>
          <span style={{ fontSize: 12.5, color: tokens.muted }}>
            {total} document{total === 1 ? "" : "s"}
          </span>
          {/* C4: the shared surface-freshness treatment (was a hand-rolled "as of" clock). */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <SurfaceFreshnessBadge noun="Docs" derivedAt={docIndex.derivedAt} sources={docIndex.sources} now={now} />
            <StaleSourcePills sources={docIndex.sources} />
          </div>
        </header>
      ) : null}

      {!showViewerOnly && facetBar ? <div style={{ minWidth: 0 }}>{facetBar}</div> : null}

      {isMobile ? (
        showViewerOnly ? (
          <div style={{ minWidth: 0 }}>{viewer}</div>
        ) : (
          <DocTree docIndex={docIndex} selectedDocId={selectedDocId} onSelect={onSelect} now={now} />
        )
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 380px) minmax(0, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
          <DocTree docIndex={docIndex} selectedDocId={selectedDocId} onSelect={onSelect} now={now} />
          <div style={{ minWidth: 0, padding: 18, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
            {viewer}
          </div>
        </div>
      )}
    </div>
  );
}
