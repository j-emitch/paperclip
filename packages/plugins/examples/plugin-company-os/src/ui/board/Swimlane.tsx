/**
 * A swimlane = one L2 subsystem under its L1 system. Built on the shared
 * `CollapsibleLane` frame. When open it shows a column-header row (desktop)
 * aligned to the row grid, then one `PrefixRow` per registered family. Each row
 * carries its own home repo (per-row, contract: `PrefixRow.repos` is home-first)
 * so the cross-repo badge is correct regardless of row ordering.
 */

import type { ColumnId } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { CollapsibleLane } from "./CollapsibleLane.js";
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
  return (
    <CollapsibleLane
      laneId={lane.id}
      collapsed={collapsed}
      onToggle={onToggle}
      isMobile={isMobile}
      toggleLabel={`${collapsed ? "Expand" : "Collapse"} ${lane.l1System} ${lane.l2Subsystem} lane`}
      header={
        <>
          <span
            style={{
              fontSize: 14,
              fontWeight: 650,
              color: tokens.fg,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {lane.l2Subsystem}
          </span>
          <SystemBadge label={lane.l1System} />
        </>
      }
      trailing={<LaneCounts total={view.total} rowCount={view.rows.length} />}
    >
      {!isMobile ? (
        <div style={{ display: "grid", gridTemplateColumns: rowGridTemplate(columns.length), gap: 8, paddingBottom: 4 }}>
          <span aria-hidden="true" />
          {columns.map((column) => (
            <span
              key={column}
              style={{ fontSize: 10.5, fontWeight: 600, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              {COLUMN_LABELS[column]}
            </span>
          ))}
        </div>
      ) : null}
      {view.rows.length === 0 ? (
        <p style={{ margin: "8px 2px", fontSize: 12.5, color: tokens.muted }}>No families registered in this lane yet.</p>
      ) : (
        view.rows.map((rowView) => (
          <PrefixRow key={rowView.row.prefix} view={rowView} columns={columns} isMobile={isMobile} now={now} />
        ))
      )}
    </CollapsibleLane>
  );
}

function SystemBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: tokens.mono,
        color: tokens.accent,
        background: tokens.accentSoft,
        border: `1px solid ${tokens.accentBorder}`,
        borderRadius: 4,
        padding: "0 6px",
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function LaneCounts({ total, rowCount }: { total: number; rowCount: number }) {
  return (
    <span
      aria-label={`${total} chip${total === 1 ? "" : "s"} across ${rowCount} famil${rowCount === 1 ? "y" : "ies"}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: tokens.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
    >
      <strong style={{ color: total > 0 ? tokens.fg : tokens.muted, fontWeight: 700 }}>{total}</strong>
      <span aria-hidden="true">·</span>
      <span>{rowCount} fam</span>
    </span>
  );
}
