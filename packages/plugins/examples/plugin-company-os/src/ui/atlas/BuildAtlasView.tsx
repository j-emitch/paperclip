/**
 * `BuildAtlasView` — the PURE Build Atlas renderer (the authorized Board-view
 * replacement, D6 decision 1). A function of `BuildAtlasV1` (+ a `now` clock +
 * refresh callbacks) and nothing else: no data fetching, no SDK runtime, no
 * derivation. The worker derives; the UI renders. That keeps every atlas state
 * trivially unit-testable (SSR + the Playwright harness inject a golden
 * `BuildAtlasV1`) and the contract crisp. The data-connected `Atlas` wraps this
 * with `useBuildAtlas`.
 *
 * Composition mirrors the cockpit's other surfaces: a vitals masthead (with the
 * shared freshness + stale-source treatment), domain sections of family cards, the
 * lineage lane-groups, and a diagnostics rail — each region staggered in via the
 * reduced-motion-gated `cos-fx-enter`. Reuses tokens / badges / surface-styles /
 * cockpit-motion; clean dividers, no card-in-card.
 */

import type { CSSProperties, ReactNode } from "react";
import type { AtlasDiagnosticV1, BuildAtlasV1, GateState } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { withAlpha } from "../shared/color.js";
import { Dot } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { StaleSourcePills } from "../shared/freshness.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { RefreshIcon } from "../icons.js";
import { FamilyCard } from "./FamilyCard.js";
import { LineageView } from "./LineageView.js";
import { GATE_TONE } from "./LifecycleStepper.js";
import {
  buildAtlasView,
  isAtlasStale,
  isClockSkewed,
  relativeTime,
  type AtlasVitals,
  type DomainSection,
} from "./atlas-view-model.js";

export interface BuildAtlasViewProps {
  atlas: BuildAtlasV1;
  /** Clock for relative-time + staleness. Injected so tests are deterministic. */
  now: number;
  isMobile?: boolean;
  /** Manual refresh (triggers a worker derive); optional + disabled while in flight. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Last manual-refresh failure (the displayed atlas is the last good snapshot). */
  refreshError?: string | null;
}

export function BuildAtlasView({ atlas, now, isMobile = false, onRefresh, refreshing = false, refreshError = null }: BuildAtlasViewProps) {
  const view = buildAtlasView(atlas);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20, minWidth: 0, fontFamily: tokens.font }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      <Reveal delayMs={0}>
        <Masthead
          vitals={view.vitals}
          atlas={atlas}
          now={now}
          isMobile={isMobile}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      </Reveal>

      <Reveal delayMs={40}>
        <LifecycleLegend />
      </Reveal>

      {refreshError ? (
        <Reveal delayMs={40}>
          <RefreshErrorBar message={refreshError} />
        </Reveal>
      ) : null}

      {view.sections.map((section, i) => (
        <Reveal key={section.domain.id} delayMs={70 + i * 60}>
          <DomainSectionView section={section} now={now} isMobile={isMobile} />
        </Reveal>
      ))}

      {atlas.laneGroups.length > 0 ? (
        <Reveal delayMs={70 + view.sections.length * 60}>
          <LineageView laneGroups={atlas.laneGroups} edges={atlas.edges} families={atlas.families} isMobile={isMobile} />
        </Reveal>
      ) : null}

      <Reveal delayMs={110 + view.sections.length * 60}>
        <DiagnosticsRail diagnostics={atlas.diagnostics} sourceDiagnosticsCount={atlas.sourceDiagnostics.length} />
      </Reveal>

      <FooterMeta derivedAt={atlas.derivedAt} sourceCount={atlas.sources.length} />
    </div>
  );
}

/** A staggered entrance wrapper — `cos-fx-enter` is reduced-motion-gated (no-op when reduced). */
function Reveal({ delayMs, children }: { delayMs: number; children: ReactNode }) {
  return (
    <div className="cos-fx-enter" style={{ animationDelay: delayMs + "ms" }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masthead — vitals + freshness + refresh
// ---------------------------------------------------------------------------

function Masthead({
  vitals,
  atlas,
  now,
  isMobile,
  onRefresh,
  refreshing,
}: {
  vitals: AtlasVitals;
  atlas: BuildAtlasV1;
  now: number;
  isMobile: boolean;
  onRefresh?: () => void;
  refreshing: boolean;
}) {
  const tiles: Array<{ value: string; label: string; tone?: string }> = [
    { value: String(vitals.familyCount), label: "Families" },
    { value: String(vitals.domainCount), label: "Domains" },
    { value: String(vitals.shippedBuilds), label: "Shipped builds" },
    { value: String(vitals.laneCount), label: "Lineage lanes" },
    { value: String(vitals.diagnosticsCount), label: "Diagnostics", tone: vitals.diagnosticsCount > 0 ? statusColors.revise : undefined },
  ];
  const stale = isAtlasStale(atlas, now);
  const skewed = isClockSkewed(atlas, now);
  const ageLabel = relativeTime(atlas.derivedAt, now) ?? "unknown";

  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: isMobile ? 16 : 18,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderTop: `3px solid ${tokens.accent}`,
        borderRadius: tokens.radius,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: tokens.fg, letterSpacing: -0.2 }}>Build Atlas</h2>
        <span style={{ fontSize: 12.5, color: tokens.muted }}>
          Every spec-prefix family — lifecycle, builds, and lineage across the workspace.
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: 10 }}>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "10px 12px",
              background: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radiusSm,
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color: tile.tone ?? tokens.fg, letterSpacing: -0.3, fontVariantNumeric: "tabular-nums" }}>
              {tile.value}
            </span>
            <span style={{ fontSize: 11, color: tokens.muted }}>{tile.label}</span>
          </div>
        ))}
      </div>

      {/* Freshness + controls row. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <FreshnessBadge ageLabel={ageLabel} stale={stale} skewed={skewed} />
        <span style={{ fontSize: 12, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
          {vitals.builtSummary} · {vitals.edgeCount} lineage link{vitals.edgeCount === 1 ? "" : "s"}
        </span>
        <StaleSourcePills sources={atlas.sources} />
        {onRefresh ? (
          <button
            type="button"
            className="cos-refresh"
            data-spinning={refreshing}
            onClick={onRefresh}
            disabled={refreshing}
            style={{ ...toolbarButtonStyle, marginLeft: "auto", opacity: refreshing ? 0.7 : 1, cursor: refreshing ? "default" : "pointer" }}
            aria-label={refreshing ? "Refreshing the atlas" : "Refresh the atlas"}
          >
            <span aria-hidden="true" className="cos-caret" style={{ display: "inline-flex" }}>
              <RefreshIcon size={13} />
            </span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

/** Surface freshness — derive age + clock-skew. Mirrors the Board's badge a11y contract
 *  (unifying the two into one shared primitive is a 5i cohesion item — see atlas-view-model). */
function FreshnessBadge({ ageLabel, stale, skewed }: { ageLabel: string; stale: boolean; skewed: boolean }) {
  if (skewed) {
    const aria = "Atlas derive timestamp is in the future — likely clock skew between machines";
    return (
      <span style={badgeStyle} aria-label={aria} title={aria}>
        <Dot tone={statusColors.cached} />
        <span aria-hidden="true">derived in the future · clock skew</span>
      </span>
    );
  }
  const tone = stale ? statusColors.stale : statusColors.live;
  const aria = stale ? `Atlas is stale — derived ${ageLabel}` : `Atlas is live — derived ${ageLabel}`;
  return (
    <span style={badgeStyle} aria-label={aria} title={aria}>
      {stale ? (
        <Dot tone={tone} />
      ) : (
        // Live: a gentle green ring pulse (reduced-motion-gated in cockpit-motion).
        <span aria-hidden="true" className="cos-fx-live-dot" style={{ display: "inline-block", width: 8, height: 8, background: tone, flex: "0 0 auto" }} />
      )}
      <span aria-hidden="true">
        derived {ageLabel}
        {stale ? " · stale" : ""}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Domain section — family cards
// ---------------------------------------------------------------------------

function DomainSectionView({ section, now, isMobile }: { section: DomainSection; now: number; isMobile: boolean }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>
          {section.domain.title}
        </h3>
        <span style={{ fontSize: 11.5, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
          {section.families.length} famil{section.families.length === 1 ? "y" : "ies"}
          {section.total > 0 ? ` · ${section.shipped}/${section.total} shipped` : ""}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        {section.families.map((family) => (
          <FamilyCard key={family.prefix} family={family} now={now} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Diagnostics rail
// ---------------------------------------------------------------------------

/** Warn before info — the atlas rail surfaces derivation problems worst-first. */
const SEVERITY_RANK: Record<AtlasDiagnosticV1["severity"], number> = { warn: 0, info: 1 };

function DiagnosticsRail({ diagnostics, sourceDiagnosticsCount }: { diagnostics: readonly AtlasDiagnosticV1[]; sourceDiagnosticsCount: number }) {
  const sorted = [...diagnostics].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const warnCount = diagnostics.filter((d) => d.severity === "warn").length;
  const infoCount = diagnostics.length - warnCount;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>Diagnostics</h3>
        <span style={{ fontSize: 11.5, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
          {warnCount} warn · {infoCount} info{sourceDiagnosticsCount > 0 ? ` · ${sourceDiagnosticsCount} source` : ""}
        </span>
      </div>
      {sorted.length === 0 && sourceDiagnosticsCount === 0 ? (
        <CalmNote tone={statusColors.ship}>All clear — every source is live and every family resolved into the lineage.</CalmNote>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((diag, i) => (
            <DiagnosticRow key={`${diag.code}:${diag.prefix ?? "_"}:${i}`} diag={diag} />
          ))}
          {sourceDiagnosticsCount > 0 ? (
            <li style={{ fontSize: 12, color: tokens.muted, padding: "2px 2px" }}>
              {sourceDiagnosticsCount} source diagnostic{sourceDiagnosticsCount === 1 ? "" : "s"} this derive — see the source badges above.
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

function DiagnosticRow({ diag }: { diag: AtlasDiagnosticV1 }) {
  const tone = diag.severity === "warn" ? statusColors.revise : statusColors.proceed;
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 10px",
        borderRadius: tokens.radiusSm,
        background: withAlpha(tone, 0.1),
        border: `1px solid ${withAlpha(tone, 0.34)}`,
        fontSize: 12.5,
        color: tokens.fg,
      }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: tone, marginTop: 4, flex: "0 0 auto" }} />
      <span style={{ minWidth: 0 }}>
        {diag.prefix ? <strong style={{ fontFamily: tokens.mono, fontWeight: 700 }}>{diag.prefix}</strong> : null}
        {diag.prefix ? " — " : ""}
        {diag.message}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/** Decodes the compact family-card pips — the gate order + the state colour key,
 *  shown once so dense cards stay legible without per-card labels. */
function LifecycleLegend() {
  const states: Array<{ state: GateState; label: string }> = [
    { state: "done", label: "done" },
    { state: "active", label: "active" },
    { state: "warn", label: "needs attention" },
    { state: "todo", label: "not started" },
  ];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "7px 12px",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusSm,
        fontSize: 11.5,
        color: tokens.muted,
      }}
    >
      <span style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", fontSize: 10.5 }}>Lifecycle</span>
      <span aria-hidden="true" style={{ fontFamily: tokens.mono, color: tokens.fg }}>
        Spec → Plan → Build → Prod
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
        {states.map((s) => (
          <span key={s.state} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span
              aria-hidden="true"
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                border: `1px solid ${s.state === "todo" ? tokens.border : GATE_TONE[s.state]}`,
                background: s.state === "todo" ? "transparent" : withAlpha(GATE_TONE[s.state], 0.85),
              }}
            />
            {s.label}
          </span>
        ))}
      </span>
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
        background: withAlpha(statusColors.danger, 0.12),
        border: `1px solid ${withAlpha(statusColors.danger, 0.38)}`,
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

const badgeStyle: CSSProperties = {
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

const toolbarButtonStyle: CSSProperties = {
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
};
