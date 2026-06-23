/**
 * One prefix-family row inside a swimlane: a sticky row-label (prefix + family,
 * with a generic-prefix anti-pattern marker and cross-repo badges) followed by
 * one cell per column. Zero-count cells are shown, not hidden (Joe: show the 0,
 * don't hide the empty state). Desktop is a 4-column grid aligned to the lane
 * header; mobile stacks the columns with their labels.
 */

import type { CSSProperties } from "react";
import type { ColumnId } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Chip } from "./Chip.js";
import { COLUMN_LABELS, type RowView } from "./view-model.js";

/** Shared grid template so the lane header and every row align pixel-for-pixel. */
export function rowGridTemplate(columnCount: number): string {
  return `minmax(140px, 210px) repeat(${columnCount}, minmax(0, 1fr))`;
}

export function PrefixRow({
  view,
  columns,
  laneHomeRepo,
  isMobile,
  now,
}: {
  view: RowView;
  columns: ColumnId[];
  laneHomeRepo: string | null;
  isMobile: boolean;
  now: number;
}) {
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderTop: `1px solid ${tokens.border}` }}>
        <RowLabel view={view} laneHomeRepo={laneHomeRepo} />
        {view.cells.map((cell) => (
          <div key={cell.column} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
              {COLUMN_LABELS[cell.column]} · {cell.chips.length}
            </span>
            {cell.chips.length === 0 ? (
              <EmptyCell />
            ) : (
              cell.chips.map((chip, i) => (
                <Chip key={chip.id} chip={chip} laneHomeRepo={laneHomeRepo} now={now} index={i} />
              ))
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: rowGridTemplate(columns.length),
        gap: 8,
        padding: "8px 0",
        borderTop: `1px solid ${tokens.border}`,
        alignItems: "start",
      }}
    >
      <RowLabel view={view} laneHomeRepo={laneHomeRepo} />
      {view.cells.map((cell) => (
        <div key={cell.column} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          {cell.chips.length === 0 ? (
            <EmptyCell />
          ) : (
            cell.chips.map((chip, i) => (
              <Chip key={chip.id} chip={chip} laneHomeRepo={laneHomeRepo} now={now} index={i} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function RowLabel({ view, laneHomeRepo }: { view: RowView; laneHomeRepo: string | null }) {
  const { row, total } = view;
  const crossRepos = row.repos.filter((r) => r !== laneHomeRepo);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingRight: 8, minWidth: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: tokens.mono, fontSize: 12.5, fontWeight: 700, color: tokens.fg }}>{row.prefix}</span>
        {row.isGeneric ? <GenericMarker /> : null}
        <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>· {total}</span>
      </span>
      <span style={{ fontSize: 11.5, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.family}
      </span>
      {crossRepos.length > 0 ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 1 }}>
          {crossRepos.map((repo) => (
            <span
              key={repo}
              style={{
                fontSize: 9.5,
                fontFamily: tokens.mono,
                color: tokens.muted,
                border: `1px solid ${tokens.border}`,
                borderRadius: 4,
                padding: "0 4px",
                lineHeight: "15px",
              }}
            >
              {repo}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function GenericMarker() {
  return (
    <span
      aria-label="generic prefix — anti-pattern; prefer a specific family"
      title="Generic prefix — anti-pattern; prefer a specific family"
      style={{
        fontSize: 9.5,
        fontWeight: 700,
        fontFamily: tokens.mono,
        color: statusColors.generic,
        background: "color-mix(in oklch, " + statusColors.generic + " 16%, transparent)",
        border: `1px solid color-mix(in oklch, ${statusColors.generic} 42%, transparent)`,
        borderRadius: 4,
        padding: "0 4px",
        lineHeight: "15px",
      }}
    >
      generic
    </span>
  );
}

function EmptyCell() {
  const style: CSSProperties = {
    minHeight: 26,
    borderRadius: tokens.radiusSm,
    border: `1px dashed color-mix(in oklch, ${tokens.border} 70%, transparent)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "color-mix(in oklch, " + tokens.muted + " 55%, transparent)",
    fontSize: 12,
  };
  return (
    <div style={style} aria-hidden="true">
      —
    </div>
  );
}
