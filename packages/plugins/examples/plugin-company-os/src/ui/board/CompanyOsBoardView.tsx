/**
 * `CompanyOsBoardView` — the PURE auto-Kanban renderer.
 *
 * It is a function of `BoardStateV1` (+ a `now` clock + collapse state passed in)
 * and nothing else: no data fetching, no SDK runtime, no derivation. That makes
 * every board state trivially unit-testable (SSR + the Playwright harness inject
 * a golden `BoardStateV1`) and keeps the contract crisp — the worker derives, the
 * UI renders. The data-connected `CompanyOsBoard` wraps this with `useBoard`.
 */

import type { BoardStateV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { RefreshIcon } from "../icons.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { StaleSourcePills, SurfaceFreshnessBadge } from "../shared/freshness.js";
import { BOARD_ROOT_CLASS, BoardStyles } from "./board-styles.js";
import { Swimlane } from "./Swimlane.js";
import { UnclassifiedLane } from "./UnclassifiedLane.js";
import { buildBoardView } from "./view-model.js";

export interface CompanyOsBoardViewProps {
  state: BoardStateV1;
  /** Clock for relative-time + staleness. Injected so tests are deterministic. */
  now: number;
  isMobile: boolean;
  /** Lane ids currently collapsed. */
  collapsedLanes: ReadonlySet<string>;
  onToggleLane: (laneId: string) => void;
  /** Collapse/expand every lane at once (toolbar control); optional. */
  onSetAllCollapsed?: (collapsed: boolean) => void;
  /** Manual refresh (triggers a worker derive); optional + disabled while in flight. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Last manual-refresh failure (the displayed board is the last good snapshot). */
  refreshError?: string | null;
}

export function CompanyOsBoardView({
  state,
  now,
  isMobile,
  collapsedLanes,
  onToggleLane,
  onSetAllCollapsed,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: CompanyOsBoardViewProps) {
  const view = buildBoardView(state);
  const allCollapsed = view.lanes.every((l) => collapsedLanes.has(l.lane.id)) && (!view.ops || collapsedLanes.has(view.ops.lane.id));

  return (
    <div className={BOARD_ROOT_CLASS} style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: tokens.font }}>
      <BoardStyles />
      {/* The shared surface-freshness badge's live pulse (`cos-fx-live-dot`) lives in this
          stylesheet — the retained fallback board injects it too so the dot pulses here. */}
      <CockpitMotionStyles />

      {/* Toolbar — freshness, counts, stale-source badges, controls. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          paddingBottom: 10,
          borderBottom: `1px solid ${tokens.border}`,
        }}
      >
        <SurfaceFreshnessBadge noun="Board" derivedAt={state.derivedAt} sources={state.sources} now={now} />
        <Counts chips={view.chipCount} unclassified={view.unclassifiedCount} />
        <span style={{ flex: 1 }} />
        <StaleSourcePills sources={state.sources} />
        {onSetAllCollapsed ? (
          <button
            type="button"
            className="cos-refresh"
            onClick={() => onSetAllCollapsed(!allCollapsed)}
            style={toolbarButtonStyle}
            aria-label={allCollapsed ? "Expand all lanes" : "Collapse all lanes"}
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            className="cos-refresh"
            data-spinning={refreshing}
            onClick={onRefresh}
            disabled={refreshing}
            style={{ ...toolbarButtonStyle, opacity: refreshing ? 0.7 : 1, cursor: refreshing ? "default" : "pointer" }}
            aria-label={refreshing ? "Refreshing the board" : "Refresh the board"}
          >
            <span aria-hidden="true" className="cos-caret" style={{ display: "inline-flex" }}>
              <RefreshIcon size={13} />
            </span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      {/* A failed manual refresh — the board below is the last good snapshot. */}
      {refreshError ? <RefreshErrorBar message={refreshError} /> : null}

      {/* Warn-level diagnostics, surfaced compactly above the lanes. */}
      {state.diagnostics.length > 0 ? <DiagnosticsBar count={state.diagnostics.length} /> : null}

      {/* Lanes. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {view.lanes.map((laneView) => (
          <Swimlane
            key={laneView.lane.id}
            view={laneView}
            columns={view.columns}
            isMobile={isMobile}
            collapsed={collapsedLanes.has(laneView.lane.id)}
            onToggle={onToggleLane}
            now={now}
          />
        ))}
        {view.ops ? (
          <UnclassifiedLane
            lane={view.ops.lane}
            chips={view.ops.chips}
            collapsed={collapsedLanes.has(view.ops.lane.id)}
            onToggle={onToggleLane}
            isMobile={isMobile}
          />
        ) : null}
        {view.lanes.length === 0 && !view.ops ? (
          <p style={{ margin: "12px 2px", fontSize: 13, color: tokens.muted }}>
            No lanes yet — the prefix registry hasn’t produced a taxonomy. Register prefixes to populate the board.
          </p>
        ) : null}
      </div>

      <FooterMeta derivedAt={state.derivedAt} sourceCount={state.sources.length} />
    </div>
  );
}

function Counts({ chips, unclassified }: { chips: number; unclassified: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12.5, color: tokens.muted }}>
      <span aria-label={`${chips} chip${chips === 1 ? "" : "s"} on the board`}>
        <strong style={{ color: tokens.fg, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{chips}</strong> chips
      </span>
      {unclassified > 0 ? (
        <span aria-label={`${unclassified} unclassified`} style={{ color: statusColors.generic }}>
          <strong style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{unclassified}</strong> unclassified
        </span>
      ) : null}
    </span>
  );
}

function DiagnosticsBar({ count }: { count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: tokens.radiusSm,
        background: "color-mix(in oklch, " + statusColors.cached + " 12%, transparent)",
        border: `1px solid color-mix(in oklch, ${statusColors.cached} 34%, transparent)`,
        fontSize: 12.5,
        color: tokens.fg,
      }}
      role="status"
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: statusColors.cached }} />
      {count} derive diagnostic{count === 1 ? "" : "s"} — some sources reported a non-fatal issue this run.
    </div>
  );
}

function RefreshErrorBar({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: tokens.radiusSm,
        background: "color-mix(in oklch, " + statusColors.danger + " 12%, transparent)",
        border: `1px solid color-mix(in oklch, ${statusColors.danger} 38%, transparent)`,
        fontSize: 12.5,
        color: tokens.fg,
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: statusColors.danger }} />
      Refresh failed — showing the last good snapshot. {message}
    </div>
  );
}

function FooterMeta({ derivedAt, sourceCount }: { derivedAt: string; sourceCount: number }) {
  return (
    <p style={{ margin: "2px 0 0", fontSize: 11, color: tokens.muted, fontFamily: tokens.mono }}>
      derived {derivedAt} · {sourceCount} source{sourceCount === 1 ? "" : "s"}
    </p>
  );
}

const toolbarButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 11px",
  borderRadius: tokens.radiusSm,
  background: tokens.secondary,
  border: `1px solid ${tokens.border}`,
  color: tokens.muted,
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
} as const;
