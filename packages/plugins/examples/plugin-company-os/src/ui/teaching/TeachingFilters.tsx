/**
 * Pure filter bar for the Teaching tab (COS-2f) — search + audience/publish
 * segmented chips + a lens select, every control driven by the `TeachingView`
 * facet counts and the active `TeachingFilter` (faceted: selecting one narrows the
 * others). Each chip carries a tone DOT so the filter bar doubles as a legend for
 * the per-unit pills, while selection stays the cockpit's accent (calm + clear).
 * No SDK runtime — SSR-faithful.
 */

import type { ChangeEvent } from "react";
import { tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { SearchIcon, CloseIcon } from "../icons.js";
import {
  ALL,
  AUDIENCE_TONES,
  EMPTY_TEACHING_FILTER,
  LENS_LABELS,
  LENS_TONES,
  PUBLISH_TONES,
  type Facet,
  type TeachingFilter,
  type TeachingView,
} from "./teaching-view-model.js";
import type { TeachingAudience, TeachingLens, TeachingPublishState } from "../../contracts/index.js";

export interface TeachingFiltersProps {
  view: TeachingView;
  filter: TeachingFilter;
  onChange: (next: TeachingFilter) => void;
  isMobile?: boolean;
}

export function TeachingFilters({ view, filter, onChange, isMobile = false }: TeachingFiltersProps) {
  const active =
    filter.audience !== ALL || filter.publishState !== ALL || filter.lens !== ALL || filter.search.trim() !== "";

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
            placeholder="Search lessons…"
            aria-label="Search teaching units"
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...filter, search: e.target.value })}
            // No inline `outline:none` — the shared `input:focus-visible` rule
            // (CockpitSurfaceStyles) must show a keyboard focus ring (WCAG 2.4.7) [codex-B P1].
            style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: tokens.fg, font: "inherit", fontSize: 13 }}
          />
        </label>
        <LensSelect
          value={filter.lens}
          facets={view.lensFacets}
          onPick={(v) => onChange({ ...filter, lens: v })}
        />
        {active ? (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_TEACHING_FILTER })}
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

      <Segmented
        groupLabel="Filter by audience"
        facets={view.audienceFacets}
        selected={filter.audience}
        tones={AUDIENCE_TONES}
        onPick={(v) => onChange({ ...filter, audience: v as TeachingAudience | typeof ALL })}
      />
      <Segmented
        groupLabel="Filter by publish state"
        facets={view.publishFacets}
        selected={filter.publishState}
        tones={PUBLISH_TONES}
        onPick={(v) => onChange({ ...filter, publishState: v as TeachingPublishState | typeof ALL })}
      />
    </div>
  );
}

function Segmented<V extends string>({
  groupLabel,
  facets,
  selected,
  tones,
  onPick,
}: {
  groupLabel: string;
  facets: Facet<V | typeof ALL>[];
  selected: V | typeof ALL;
  tones: Record<string, string>;
  onPick: (value: V | typeof ALL) => void;
}) {
  return (
    <div role="group" aria-label={groupLabel} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {facets.map((f) => {
        const isSelected = selected === f.value;
        const tone = f.value === ALL ? tokens.muted : tones[f.value] ?? tokens.muted;
        return (
          <button
            key={String(f.value)}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onPick(f.value)}
            className="cos-chip-hover"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              borderRadius: 999,
              border: `1px solid ${isSelected ? tokens.accentBorder : tokens.border}`,
              background: isSelected ? tokens.accentSoft : "transparent",
              color: isSelected ? tokens.accent : tokens.muted,
              font: "inherit",
              fontSize: 12.5,
              fontWeight: isSelected ? 650 : 500,
              cursor: "pointer",
            }}
          >
            {f.value !== ALL ? <Dot tone={tone} size={7} /> : null}
            {f.label}
            <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? tokens.accent : tokens.muted, opacity: 0.85, fontFamily: tokens.mono }}>
              {f.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LensSelect({
  value,
  facets,
  onPick,
}: {
  value: TeachingLens | typeof ALL;
  facets: Facet<TeachingLens | typeof ALL>[];
  onPick: (value: TeachingLens | typeof ALL) => void;
}) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Lens</span>
      <select
        value={value}
        aria-label="Filter by lens"
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onPick(e.target.value as TeachingLens | typeof ALL)}
        style={{
          padding: "7px 9px",
          borderRadius: tokens.radiusSm,
          background: tokens.bg,
          border: `1px solid ${value !== ALL ? tokens.accentBorder : tokens.border}`,
          color: value !== ALL ? tokens.fg : tokens.muted,
          font: "inherit",
          fontSize: 12.5,
          cursor: "pointer",
          maxWidth: 180,
        }}
      >
        <option value={ALL}>Lens: all</option>
        {facets
          .filter((f) => f.value !== ALL)
          .map((f) => (
            <option key={f.value} value={f.value}>
              {LENS_LABELS[f.value as TeachingLens]} ({f.count})
            </option>
          ))}
      </select>
    </label>
  );
}
