/**
 * Shared freshness UI — the ONE surface-freshness treatment across the cockpit.
 *
 * - `SurfaceFreshnessBadge` — the surface-level "derived 3m ago · stale" pill
 *   (with the clock-skew + live-pulse states). Board, Atlas, and Branch·PR all
 *   render this with only a `noun`, so the badge reads + degrades identically on
 *   every tab. It computes its own verdict from the projection's `{derivedAt,
 *   sources}` via `deriveFreshness`, so callers pass raw contract data — no
 *   per-surface staleness math. It renders NO stylesheet of its own (the live
 *   pulse's `cos-fx-live-dot` comes from the surface's `CockpitMotionStyles`),
 *   so a surface that injects that stylesheet keeps injecting it exactly once.
 * - `StaleSourcePills` — the per-source honest-degradation cluster: one pill per
 *   non-live source (`source · repo · stale · 2 errors`). Returns null when every
 *   source is live (no badge noise on a clean read).
 *
 * Pure + deterministic (an injected `now`, no `Date.now()`).
 */

import type { CSSProperties } from "react";
import type { SourceFreshness } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot, Pill } from "./badges.js";
import { deriveFreshness } from "./derive-freshness.js";
import { relativeTime } from "./time.js";

const surfacePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  // A touch of room so the live dot's pulse ring stays graceful inside the pill.
  padding: "4px 10px",
  borderRadius: 999,
  background: tokens.secondary,
  border: `1px solid ${tokens.border}`,
  fontSize: 11.5,
  fontWeight: 500,
  color: tokens.fg,
  whiteSpace: "nowrap",
};

/** Count phrasing for a stale-source suffix (aria + pill): "2 errors", "1 error". */
function errorPhrase(count: number): string {
  return `${count} error${count === 1 ? "" : "s"}`;
}

/**
 * Surface-level freshness badge — one component for every tab. `noun` names the
 * surface ("Board", "Atlas", "Branch · PR") so the a11y label reads naturally, and
 * everything else is derived from the projection's `{derivedAt, sources}` + `now`.
 * Live is a gentle green pulse; stale + clock-skew each get their own honest tone.
 */
export function SurfaceFreshnessBadge({
  noun,
  derivedAt,
  sources,
  now,
}: {
  noun: string;
  derivedAt: string;
  sources: readonly SourceFreshness[];
  now: number;
}) {
  const { stale, skewed, staleSourceCount } = deriveFreshness({ derivedAt, sources }, now);
  const ageLabel = relativeTime(derivedAt, now) ?? "unknown";
  // A hover warms the border to the state's tone (cockpit-motion); reduced-motion stills it.
  const freshClass = `cos-fx-fresh cos-fx-fresh-${skewed ? "skew" : stale ? "stale" : "live"}`;

  if (skewed) {
    const aria = `${noun} derive timestamp is in the future — likely clock skew between machines`;
    // The exact derive stamp on hover; the relative phrasing stays the screen-reader label.
    return (
      <span className={freshClass} style={surfacePillStyle} aria-label={aria} title={`${aria} · derived ${derivedAt}`}>
        <Dot tone={statusColors.cached} />
        <span aria-hidden="true">derived in the future · clock skew</span>
      </span>
    );
  }

  const tone = stale ? statusColors.stale : statusColors.live;
  const sourceSuffix = stale && staleSourceCount > 0 ? `, ${staleSourceCount} source${staleSourceCount === 1 ? "" : "s"} not live` : "";
  const aria = stale ? `${noun} is stale — derived ${ageLabel}${sourceSuffix}` : `${noun} is live — derived ${ageLabel}`;
  return (
    <span className={freshClass} style={surfacePillStyle} aria-label={aria} title={`${aria} · derived ${derivedAt}`}>
      <Dot tone={tone} pulse={!stale} />
      <span aria-hidden="true">
        derived {ageLabel}
        {stale ? " · stale" : ""}
      </span>
    </span>
  );
}

/**
 * The honest-degradation cluster shown in a surface header when one or more
 * underlying sources isn't `live` (cached/stale). Every surface embeds its
 * projection's `sources[]`, so this renders the same right-aligned "source
 * freshness" badges everywhere. Returns null when everything is live.
 */
export function StaleSourcePills({ sources }: { sources: readonly SourceFreshness[] }) {
  const stale = sources.filter((s) => s.freshness !== "live");
  if (stale.length === 0) return null;
  return (
    <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
      {stale.map((s) => {
        // Include the repo so multiple stale repos don't collapse into identical
        // labels, and the error count so a degraded source states how badly (a
        // superset of the retired per-source board badge — no info lost on migration).
        const errorSuffix = s.errorCount > 0 ? ` · ${errorPhrase(s.errorCount)}` : "";
        // Hover reveals exactly how stale — the last successful read for this (source, repo).
        const lastOk = s.lastOkAt ? ` · last ok ${s.lastOkAt}` : " · never read successfully";
        return (
          <Pill
            key={`${s.source}:${s.repo}`}
            label={`${s.source} · ${s.repo} ${s.freshness}${errorSuffix}`}
            tone={tokens.muted}
            withDot
            title={`${s.message ?? `${s.source} · ${s.repo} is ${s.freshness}${errorSuffix}`}${lastOk}`}
          />
        );
      })}
    </div>
  );
}
