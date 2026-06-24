/**
 * Pure filter bar for the Reports tab — a search box, the type segmented chips,
 * and the system / prefix / repo facet selects. Every control is driven by the
 * `ReportsView` facet counts + the active `ReportsFilter`; selecting one narrows
 * the others (faceted search). No SDK runtime — SSR-faithful.
 */

import type { ChangeEvent } from "react";
import { tokens } from "../tokens.js";
import { SearchIcon, CloseIcon } from "../icons.js";
import { ALL, EMPTY_FILTER, type Facet, type ReportsFilter, type ReportsView } from "./reports-view-model.js";

export interface ReportFiltersProps {
  view: ReportsView;
  filter: ReportsFilter;
  onChange: (next: ReportsFilter) => void;
  isMobile?: boolean;
}

export function ReportFilters({ view, filter, onChange, isMobile = false }: ReportFiltersProps) {
  const active =
    filter.type !== ALL || filter.system !== ALL || filter.prefix !== ALL || filter.repo !== ALL || filter.search.trim() !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            flex: isMobile ? "1 1 100%" : "1 1 220px",
            minWidth: 0,
            padding: "7px 11px",
            borderRadius: tokens.radiusSm,
            background: tokens.bg,
            border: `1px solid ${tokens.border}`,
          }}
        >
          <span aria-hidden="true" style={{ display: "inline-flex", color: tokens.muted }}>
            <SearchIcon size={14} />
          </span>
          <input
            type="search"
            value={filter.search}
            placeholder="Search titles + paths…"
            aria-label="Search reports"
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...filter, search: e.target.value })}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: tokens.fg,
              font: "inherit",
              fontSize: 13,
            }}
          />
        </label>
        <FacetSelect label="System" value={filter.system} facets={view.systemFacets} onPick={(v) => onChange({ ...filter, system: v })} />
        <FacetSelect label="Prefix" value={filter.prefix} facets={view.prefixFacets} onPick={(v) => onChange({ ...filter, prefix: v })} />
        <FacetSelect label="Repo" value={filter.repo} facets={view.repoFacets} onPick={(v) => onChange({ ...filter, repo: v })} />
        {active ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_FILTER })}
            aria-label="Clear all filters"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 10px",
              borderRadius: tokens.radiusSm,
              background: "transparent",
              border: `1px solid ${tokens.border}`,
              color: tokens.muted,
              font: "inherit",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <CloseIcon size={12} />
            </span>
            Clear
          </button>
        ) : null}
      </div>

      <div role="tablist" aria-label="Filter by type" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {view.typeFacets.map((t) => {
          const selected = filter.type === t.value;
          return (
            <button
              key={String(t.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange({ ...filter, type: t.value })}
              className="cos-chip-hover"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                borderRadius: 999,
                border: `1px solid ${selected ? tokens.accentBorder : tokens.border}`,
                background: selected ? tokens.accentSoft : "transparent",
                color: selected ? tokens.accent : tokens.muted,
                font: "inherit",
                fontSize: 12.5,
                fontWeight: selected ? 650 : 500,
                cursor: "pointer",
                transition: "background-color 140ms ease, color 140ms ease, border-color 140ms ease",
              }}
            >
              {t.label}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: selected ? tokens.accent : tokens.muted,
                  opacity: 0.85,
                  fontFamily: tokens.mono,
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  facets,
  onPick,
}: {
  label: string;
  value: string;
  facets: Facet[];
  onPick: (value: string) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
      <select
        value={value}
        aria-label={`Filter by ${label.toLowerCase()}`}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onPick(e.target.value)}
        style={{
          padding: "7px 9px",
          borderRadius: tokens.radiusSm,
          background: tokens.bg,
          border: `1px solid ${value !== ALL ? tokens.accentBorder : tokens.border}`,
          color: value !== ALL ? tokens.fg : tokens.muted,
          font: "inherit",
          fontSize: 12.5,
          cursor: "pointer",
          maxWidth: 170,
        }}
      >
        <option value={ALL}>{label}: all</option>
        {facets.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label} ({f.count})
          </option>
        ))}
      </select>
    </label>
  );
}
