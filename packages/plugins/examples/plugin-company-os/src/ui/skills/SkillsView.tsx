/**
 * Pure composite for the Skills tab: a header (count + freshness), a search box,
 * the origin → collection → skill `SkillTree`, and the detail reader. The reader
 * is injected as a NODE so this stays bridge-free + SSR-screenshottable — production
 * passes the data-connected `ReportViewerPanel` (host `<MarkdownBlock>`), the harness
 * a pure one. Layout mirrors Docs: desktop = tree + reader side-by-side; mobile =
 * the tree until a skill is selected, then the reader full-width.
 */

import { useState, type ReactNode } from "react";
import type { SkillsCatalogV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { SurfaceFreshnessBadge } from "../shared/freshness.js";
import { SearchIcon } from "../icons.js";
import { SkillTree, type SkillSelection } from "./SkillTree.js";

export interface SkillsViewProps {
  /** The catalog to render (already filtered by `query` when the caller filters). */
  catalog: SkillsCatalogV1;
  /** The FULL catalog total (before filtering) — so the header can read "N of M". */
  totalUnfiltered: number;
  selectedSkillId: string | null;
  onSelect: (selection: SkillSelection) => void;
  query: string;
  onQueryChange: (next: string) => void;
  now: number;
  isMobile?: boolean;
  /** The reader pane — connected viewer (live) or a pure one (harness). */
  viewer: ReactNode;
}

export function SkillsView({
  catalog,
  totalUnfiltered,
  selectedSkillId,
  onSelect,
  query,
  onQueryChange,
  now,
  isMobile = false,
  viewer,
}: SkillsViewProps) {
  const total = catalog.total;
  const searching = query.trim() !== "";
  const showViewerOnly = isMobile && selectedSkillId !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      {!showViewerOnly ? (
        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Skills</h2>
          <span style={{ fontSize: 12.5, color: tokens.muted }}>
            {searching ? `${total} of ${totalUnfiltered}` : `${total} skill${total === 1 ? "" : "s"}`}
          </span>
          {/* B4: the shared surface-freshness badge (was a hand-rolled "as of" clock).
              The skills catalog carries no per-source freshness rows — age-only badge. */}
          <span style={{ marginLeft: "auto", display: "inline-flex" }}>
            <SurfaceFreshnessBadge noun="Skills" derivedAt={catalog.derivedAt} sources={[]} now={now} />
          </span>
        </header>
      ) : null}

      {isMobile ? (
        showViewerOnly ? (
          <div style={{ minWidth: 0 }}>{viewer}</div>
        ) : (
          <>
            <SearchBox query={query} onQueryChange={onQueryChange} />
            <SkillTree catalog={catalog} selectedSkillId={selectedSkillId} onSelect={onSelect} searching={searching} />
          </>
        )
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 400px) minmax(0, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <SearchBox query={query} onQueryChange={onQueryChange} />
            <SkillTree catalog={catalog} selectedSkillId={selectedSkillId} onSelect={onSelect} searching={searching} />
          </div>
          <div style={{ minWidth: 0, padding: 18, background: tokens.bg, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
            {viewer}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchBox({ query, onQueryChange }: { query: string; onQueryChange: (next: string) => void }) {
  // Keyboard focus must stay visible (a11y) — we suppress the native outline but
  // draw our own accent focus ring so the input is never a focus black hole.
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 10, display: "inline-flex", color: tokens.muted, pointerEvents: "none" }}>
        <SearchIcon size={14} />
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search skills…"
        aria-label="Search skills"
        style={{
          width: "100%",
          padding: "8px 12px 8px 32px",
          fontSize: 13,
          fontFamily: tokens.font,
          color: tokens.fg,
          background: tokens.card,
          border: `1px solid ${focused ? tokens.accentBorder : tokens.border}`,
          borderRadius: tokens.radiusSm,
          outline: "none",
          boxShadow: focused ? `0 0 0 2px ${tokens.accentSoft}` : "none",
          transition: "border-color 160ms ease, box-shadow 160ms ease",
        }}
      />
    </div>
  );
}
