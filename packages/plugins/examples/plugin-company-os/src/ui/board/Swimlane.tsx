/**
 * A swimlane = one L2 subsystem under its L1 system. Collapsible (the header is
 * the toggle button — `aria-expanded`, keyboard-operable, visible focus). When
 * open it shows a column-header row (desktop) aligned to the row grid, then one
 * `PrefixRow` per registered family in the lane.
 */

import type { ColumnId } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { CaretIcon } from "../icons.js";
import { PrefixRow, rowGridTemplate } from "./PrefixRow.js";
import { COLUMN_LABELS, type LaneView } from "./view-model.js";

export function Swimlane({
  view,
  columns,
  isMobile,
  collapsed,
  onToggle,
  now,
}: {
  view: LaneView;
  columns: ColumnId[];
  isMobile: boolean;
  collapsed: boolean;
  onToggle: (laneId: string) => void;
  now: number;
}) {
  const { lane } = view;
  const homeRepo = view.rows[0]?.row.repos[0] ?? null;
  const bodyId = `cos-lane-${lane.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  return (
    <section
      className="cos-lane"
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        className="cos-collapse"
        onClick={() => onToggle(lane.id)}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: isMobile ? "11px 13px" : "12px 16px",
          border: "none",
          background: "transparent",
          color: tokens.fg,
          font: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="cos-caret" data-collapsed={collapsed} aria-hidden="true" style={{ color: tokens.muted }}>
          <CaretIcon size={15} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: tokens.fg }}>{lane.l2Subsystem}</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: tokens.mono,
                color: tokens.accent,
                background: tokens.accentSoft,
                border: `1px solid ${tokens.accentBorder}`,
                borderRadius: 4,
                padding: "0 6px",
                lineHeight: "16px",
              }}
            >
              {lane.l1System}
            </span>
          </span>
        </span>
        <LaneCounts total={view.total} rowCount={view.rows.length} />
      </button>

      {collapsed ? null : (
        <div id={bodyId} style={{ padding: isMobile ? "0 13px 12px" : "0 16px 14px" }}>
          {!isMobile ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: rowGridTemplate(columns.length),
                gap: 8,
                paddingBottom: 4,
              }}
            >
              <span aria-hidden="true" />
              {columns.map((column) => (
                <span
                  key={column}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: tokens.muted,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {COLUMN_LABELS[column]}
                </span>
              ))}
            </div>
          ) : null}
          {view.rows.length === 0 ? (
            <p style={{ margin: "8px 2px", fontSize: 12.5, color: tokens.muted }}>
              No families registered in this lane yet.
            </p>
          ) : (
            view.rows.map((rowView) => (
              <PrefixRow
                key={rowView.row.prefix}
                view={rowView}
                columns={columns}
                laneHomeRepo={homeRepo}
                isMobile={isMobile}
                now={now}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function LaneCounts({ total, rowCount }: { total: number; rowCount: number }) {
  return (
    <span
      aria-label={`${total} chip${total === 1 ? "" : "s"} across ${rowCount} famil${rowCount === 1 ? "y" : "ies"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: tokens.muted,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <strong style={{ color: total > 0 ? tokens.fg : tokens.muted, fontWeight: 700 }}>{total}</strong>
      <span aria-hidden="true">·</span>
      <span>{rowCount} fam</span>
    </span>
  );
}
