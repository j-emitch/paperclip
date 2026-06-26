/**
 * `MetricsStrip` — the Home vitals bar: five current-snapshot counts (open PRs,
 * in-progress, alerts, branches needing attention, dirty worktrees). Tabular-nums
 * so the digits don't jitter; attention metrics tint when non-zero (color AND a
 * "needs attention" dot — never color alone). Tiles that have a natural
 * destination navigate there; "alerts" is summarized on this same page so it's a
 * read-only stat. Pure — the connected `Home` supplies the tab-nav callback.
 */

import type { MetricsStripV1 } from "../../contracts/index.js";
import type { CompanyOsTabKey } from "../tabs.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { withAlpha } from "../shared/color.js";

interface TileSpec {
  key: keyof MetricsStripV1;
  label: string;
  tone: string;
  /** Tint + emphasize only when the value is non-zero (an attention metric). */
  attention: boolean;
  /** Where clicking the tile lands; omitted = read-only stat. */
  to?: CompanyOsTabKey;
}

const TILES: readonly TileSpec[] = [
  { key: "inProgress", label: "In progress", tone: tokens.accent, attention: false, to: "board" },
  { key: "openPrs", label: "Open PRs", tone: statusColors.proceed, attention: false, to: "board" },
  { key: "branchesNeedingAttention", label: "Branches at risk", tone: statusColors.stale, attention: true, to: "source" },
  { key: "dirtyWorktrees", label: "Dirty worktrees", tone: statusColors.cached, attention: true, to: "source" },
  { key: "alerts", label: "Alerts", tone: statusColors.danger, attention: true },
];

export interface MetricsStripProps {
  metrics: MetricsStripV1;
  isMobile?: boolean;
  onNavigateTab?: (key: CompanyOsTabKey) => void;
}

export function MetricsStrip({ metrics, isMobile = false, onNavigateTab }: MetricsStripProps) {
  return (
    <div
      role="group"
      aria-label="Current snapshot"
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
        gap: isMobile ? 8 : 10,
      }}
    >
      {TILES.map((tile) => (
        <MetricTile key={tile.key} tile={tile} value={metrics[tile.key]} onNavigateTab={onNavigateTab} />
      ))}
    </div>
  );
}

function MetricTile({
  tile,
  value,
  onNavigateTab,
}: {
  tile: TileSpec;
  value: number;
  onNavigateTab?: (key: CompanyOsTabKey) => void;
}) {
  const flagged = tile.attention && value > 0;
  const clickable = tile.to !== undefined && onNavigateTab !== undefined;
  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Dot tone={flagged ? tile.tone : tokens.muted} size={7} />
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, color: tokens.fg, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        {clickable ? (
          <span aria-hidden="true" className="cos-home-tile-arrow" style={{ marginLeft: "auto", color: tile.tone, fontSize: 15, lineHeight: 1 }}>
            →
          </span>
        ) : null}
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>
        {tile.label}
      </span>
    </>
  );

  const baseStyle = {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: "13px 14px",
    textAlign: "left" as const,
    minWidth: 0,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${flagged ? withAlpha(tile.tone, 0.42) : tokens.border}`,
    background: flagged ? withAlpha(tile.tone, 0.1) : tokens.card,
    font: "inherit",
  };

  if (clickable) {
    return (
      <button
        type="button"
        className="cos-home-tile"
        onClick={() => onNavigateTab?.(tile.to!)}
        title={`Go to ${tile.label}`}
        style={{ ...baseStyle, cursor: "pointer" }}
      >
        {body}
      </button>
    );
  }
  return <div style={baseStyle}>{body}</div>;
}
