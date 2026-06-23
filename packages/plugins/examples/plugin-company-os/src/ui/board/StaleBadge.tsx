/**
 * Freshness badges — board-level ("derived 7m ago · stale") and per-source
 * ("pull-request · juice-bar · stale · 2 errors"). A stale source NEVER blanks
 * the board; it surfaces here so the operator knows one lane is last-good while
 * the rest is live. Icon-only color is backed by an explicit `aria-label`.
 */

import type { CSSProperties } from "react";
import type { SourceFreshness } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { FRESHNESS_LABELS } from "./view-model.js";

type Freshness = SourceFreshness["freshness"];

const TONE: Record<Freshness, string> = {
  live: statusColors.live,
  cached: statusColors.cached,
  stale: statusColors.stale,
};

/** A small status dot. `pulse` animates it (e.g. live derive); reduced-motion off via CSS. */
export function StatusDot({ color, pulse = false, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={pulse ? "cos-pulse" : undefined}
      style={{ width: size, height: size, borderRadius: 999, background: color, flex: "0 0 auto" }}
    />
  );
}

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 9px",
  borderRadius: 999,
  background: tokens.secondary,
  border: `1px solid ${tokens.border}`,
  fontSize: 11.5,
  fontWeight: 500,
  color: tokens.fg,
  whiteSpace: "nowrap",
};

/** Board-level freshness badge — derive age + the worst source freshness. */
export function BoardFreshnessBadge({
  ageLabel,
  stale,
  staleSourceCount,
}: {
  ageLabel: string;
  stale: boolean;
  staleSourceCount: number;
}) {
  const tone = stale ? statusColors.stale : statusColors.live;
  const aria = stale
    ? `Board is stale — derived ${ageLabel}${staleSourceCount > 0 ? `, ${staleSourceCount} source${staleSourceCount === 1 ? "" : "s"} not live` : ""}`
    : `Board is live — derived ${ageLabel}`;
  return (
    <span style={pillStyle} aria-label={aria} title={aria}>
      <StatusDot color={tone} pulse={!stale} />
      <span aria-hidden="true">
        derived {ageLabel}
        {stale ? " · stale" : ""}
      </span>
    </span>
  );
}

/** Per-source badge — only rendered for non-live sources (live is the silent default). */
export function StaleBadge({ source }: { source: SourceFreshness }) {
  const tone = TONE[source.freshness];
  const label = FRESHNESS_LABELS[source.freshness];
  const errorSuffix = source.errorCount > 0 ? ` · ${source.errorCount} error${source.errorCount === 1 ? "" : "s"}` : "";
  const aria = `${source.source} · ${source.repo} · ${label}${errorSuffix}${source.message ? ` — ${source.message}` : ""}`;
  return (
    <span style={{ ...pillStyle, fontFamily: tokens.mono, fontSize: 11 }} aria-label={aria} title={aria}>
      <StatusDot color={tone} size={7} />
      <span aria-hidden="true">
        {source.source} · {source.repo}
        {errorSuffix}
      </span>
    </span>
  );
}
