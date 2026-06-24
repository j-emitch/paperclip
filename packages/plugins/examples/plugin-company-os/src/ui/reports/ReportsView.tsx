/**
 * Pure composite for the Reports tab: a summary header (counts + stale-source
 * badges), the filter bar, the master list, and the detail viewer. The viewer is
 * injected as a NODE so this component stays bridge-free + SSR-screenshottable —
 * production passes the data-connected `<ConnectedReportViewer>` (which uses the
 * host `<MarkdownBlock>`), the harness passes a pure `<ReportViewerPanel>` fed a
 * `<pre>` renderer.
 *
 * Layout: desktop = list + viewer side-by-side; mobile = the list until a doc is
 * selected, then the viewer full-width (the viewer's back control clears it).
 */

import type { ArtifactEntry, ArtifactIndexV1, SourceFreshness } from "../../contracts/index.js";
import type { ReactNode } from "react";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { ReportFilters } from "./ReportFilters.js";
import { ReportList } from "./ReportList.js";
import { buildReportsView, type ReportsFilter } from "./reports-view-model.js";

export interface ReportsViewProps {
  index: ArtifactIndexV1;
  filter: ReportsFilter;
  onFilterChange: (next: ReportsFilter) => void;
  selectedKey: string | null;
  onSelect: (entry: ArtifactEntry) => void;
  now: number;
  isMobile?: boolean;
  /** The detail pane — connected viewer (live) or a pure one (harness). */
  viewer: ReactNode;
}

export function ReportsView({ index, filter, onFilterChange, selectedKey, onSelect, now, isMobile = false, viewer }: ReportsViewProps) {
  const view = buildReportsView(index, filter);
  const stale = index.sources.filter((s) => s.freshness !== "live");
  const showViewerOnly = isMobile && selectedKey !== null;

  return (
    <div role="tabpanel" aria-label="Reports" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      {!showViewerOnly ? (
        <>
          <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Reports</h2>
            <span style={{ fontSize: 12.5, color: tokens.muted }}>
              {view.shown === view.total ? `${view.total} document${view.total === 1 ? "" : "s"}` : `${view.shown} of ${view.total}`}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {stale.map((s) => (
                <StalePill key={`${s.source}:${s.repo}`} source={s} />
              ))}
            </div>
          </header>
          <ReportFilters view={view} filter={filter} onChange={onFilterChange} isMobile={isMobile} />
        </>
      ) : null}

      {isMobile ? (
        showViewerOnly ? (
          <div style={{ minWidth: 0 }}>{viewer}</div>
        ) : (
          <ReportList entries={view.entries} selectedKey={selectedKey} onSelect={onSelect} now={now} isMobile />
        )
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 340px) minmax(0, 1fr)",
            gap: 18,
            alignItems: "start",
            minWidth: 0,
          }}
        >
          <ReportList entries={view.entries} selectedKey={selectedKey} onSelect={onSelect} now={now} />
          <div
            style={{
              minWidth: 0,
              padding: 18,
              background: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radius,
            }}
          >
            {viewer}
          </div>
        </div>
      )}
    </div>
  );
}

function StalePill({ source }: { source: SourceFreshness }) {
  return (
    <Pill
      label={`${source.source} stale`}
      tone={tokens.muted}
      withDot
      title={source.message ?? `${source.source} · ${source.repo} is ${source.freshness}`}
    />
  );
}
