/**
 * Pure view for the Teaching tab (COS-2f) — the teaching-loop surface. It leads
 * with the ONE thing COS-2 exists to make un-ignorable: an `attention` banner that
 * turns red when a backlog is piling up behind a synthesis that stopped (the real
 * 199-nugget stall). Below it, two loop-health cards (Backlog · Synthesis), the
 * faceted filter bar, and the unit corpus grouped by numbered unit with per-lesson
 * lens / audience / publish pills.
 *
 * No SDK runtime — SSR-faithful, so the Playwright harness screenshots the exact
 * live tree. All motion is scoped + reduced-motion-guarded.
 */

import type { ReactNode } from "react";
import type { TeachingOverviewV1, TeachingUnitEntry } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { withAlpha } from "../shared/color.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { StaleSourcePills, SurfaceFreshnessBadge } from "../shared/freshness.js";
import { InboxIcon, ClockIcon, CheckIcon, AlertIcon, TeachingIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { TeachingFilters } from "./TeachingFilters.js";
import {
  ATTENTION_TONES,
  AUDIENCE_LABELS,
  AUDIENCE_TONES,
  LENS_LABELS,
  LENS_TONES,
  PUBLISH_LABELS,
  PUBLISH_ORDER,
  PUBLISH_TONES,
  SYNTH_VERDICT_LABELS,
  SYNTH_VERDICT_TONES,
  buildTeachingView,
  prettyUnit,
  type TeachingFilter,
} from "./teaching-view-model.js";
import type { TeachingUnitCounts } from "../../contracts/index.js";

const TEACHING_STYLE_ID = "cos-teaching-styles";

export interface TeachingViewProps {
  overview: TeachingOverviewV1;
  filter: TeachingFilter;
  onFilterChange: (next: TeachingFilter) => void;
  now: number;
  isMobile?: boolean;
}

export function TeachingView({ overview, filter, onFilterChange, now, isMobile = false }: TeachingViewProps) {
  const view = buildTeachingView(overview, filter);
  const published = overview.unitCounts.publishState.published;
  const pctPublished = view.total === 0 ? 0 : Math.round((published / view.total) * 100);

  return (
    <div role="tabpanel" aria-label="Teaching" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <TeachingKeyframes />

      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Teaching</h2>
        <span style={{ fontSize: 12.5, color: tokens.muted }}>
          {view.total} unit{view.total === 1 ? "" : "s"} · {pctPublished}% published
        </span>
        {/* B4: the shared surface-freshness treatment (was a bespoke stale-pill loop). */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <SurfaceFreshnessBadge noun="Teaching" derivedAt={overview.derivedAt} sources={overview.sources} now={now} />
          <StaleSourcePills sources={overview.sources} />
        </div>
      </header>

      {view.total > 0 ? <PublishLifecycleBar counts={overview.unitCounts} /> : null}

      <AttentionBanner overview={overview} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <BacklogCard overview={overview} now={now} />
        <SynthesisCard overview={overview} now={now} />
      </div>

      <TeachingFilters view={view} filter={filter} onChange={onFilterChange} isMobile={isMobile} />

      {view.total === 0 ? (
        <EmptyCorpus />
      ) : view.groups.length === 0 ? (
        <p style={{ margin: "4px 0", fontSize: 13, color: tokens.muted }}>No lessons match these filters.</p>
      ) : (
        view.groups.map((group) => (
          <UnitSection key={group.unit} unit={group.unit} entries={group.entries} now={now} isMobile={isMobile} />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// attention banner — the headline
// ---------------------------------------------------------------------------

function AttentionBanner({ overview }: { overview: TeachingOverviewV1 }) {
  const { level, reason } = overview.attention;
  const tone = ATTENTION_TONES[level];
  const critical = level === "critical";
  const ok = level === "ok";
  const label = ok ? "Loop healthy" : critical ? "Loop stalled" : "Needs attention";
  const detail = reason ?? "The teaching loop is capturing, grounding, and synthesizing on cadence.";

  return (
    <div
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 15px",
        borderRadius: tokens.radius,
        background: withAlpha(tone, ok ? 0.08 : 0.12),
        border: `1px solid ${withAlpha(tone, ok ? 0.3 : 0.5)}`,
      }}
    >
      <span
        aria-hidden="true"
        className={critical ? "cos-teach-pulse" : undefined}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          flex: "0 0 auto",
          borderRadius: 9,
          color: tone,
          background: withAlpha(tone, 0.16),
        }}
      >
        {ok ? <CheckIcon size={16} /> : <AlertIcon size={16} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 650, color: tokens.fg }}>{label}</p>
        <p style={{ margin: "2px 0 0", fontSize: 12.5, color: tokens.muted, lineHeight: 1.45 }}>{detail}</p>
      </div>
    </div>
  );
}

/**
 * A thin, proportional bar of the corpus's publish lifecycle
 * (private → candidate → ready → published). Visualizes maturity at a glance;
 * exact counts live in the filter chips + the header %, so this stays label-free.
 */
function PublishLifecycleBar({ counts }: { counts: TeachingUnitCounts }) {
  const total = counts.total;
  const pct = total === 0 ? 0 : Math.round((counts.publishState.published / total) * 100);
  const segments = PUBLISH_ORDER.filter((s) => counts.publishState[s] > 0);
  return (
    <div
      role="img"
      aria-label={`Corpus maturity: ${counts.publishState.published} of ${total} units published (${pct}%)`}
      style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: tokens.secondary, gap: 1.5 }}
    >
      {segments.map((s) => (
        <span
          key={s}
          title={`${counts.publishState[s]} ${PUBLISH_LABELS[s]}`}
          style={{ flexGrow: counts.publishState[s], flexBasis: 0, background: PUBLISH_TONES[s] }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// loop-health cards
// ---------------------------------------------------------------------------

function StatCard({ tone, icon, title, children }: { tone: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${tone}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ display: "inline-flex", color: tone }}>
          {icon}
        </span>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>
          {title}
        </h3>
      </div>
      {children}
    </article>
  );
}

function BacklogCard({ overview, now }: { overview: TeachingOverviewV1; now: number }) {
  const { pendingNuggets, pendingLogs, oldestPendingAt } = overview.backlog;
  const drained = pendingNuggets === 0 && pendingLogs === 0;
  const tone = drained ? SYNTH_VERDICT_TONES.fresh : overview.attention.level === "critical" ? ATTENTION_TONES.critical : ATTENTION_TONES.attention;
  const oldest = relativeTime(oldestPendingAt, now);
  return (
    <StatCard tone={tone} icon={<InboxIcon size={18} />} title="Backlog">
      {drained ? (
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: tokens.fg }}>All caught up</p>
      ) : (
        <>
          <p style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: tokens.fg, fontVariantNumeric: "tabular-nums" }}>{pendingNuggets}</span>
            <span style={{ fontSize: 12.5, color: tokens.muted }}>nugget{pendingNuggets === 1 ? "" : "s"} pending</span>
          </p>
          <p style={{ margin: 0, fontSize: 12, color: tokens.muted }}>
            across {pendingLogs} log{pendingLogs === 1 ? "" : "s"}
            {oldest ? ` · oldest ${oldest}` : ""}
          </p>
        </>
      )}
    </StatCard>
  );
}

function SynthesisCard({ overview, now }: { overview: TeachingOverviewV1; now: number }) {
  const { verdict, lastSynthesisAt } = overview.synthesis;
  const tone = SYNTH_VERDICT_TONES[verdict];
  const last = relativeTime(lastSynthesisAt, now);
  return (
    <StatCard tone={tone} icon={<ClockIcon size={16} />} title="Synthesis">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill label={SYNTH_VERDICT_LABELS[verdict]} tone={tone} soft withDot />
        <span style={{ fontSize: 12.5, color: tokens.muted }}>{last ? `last run ${last}` : "never run"}</span>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, lineHeight: 1.4 }}>
        Librarian Routine 12 synthesizes the inbox into units.
      </p>
    </StatCard>
  );
}

// ---------------------------------------------------------------------------
// unit sections + lesson cards
// ---------------------------------------------------------------------------

function UnitSection({ unit, entries, now, isMobile }: { unit: string; entries: TeachingUnitEntry[]; now: number; isMobile: boolean }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.2, color: tokens.fg }}>{prettyUnit(unit)}</h3>
        <span style={{ fontSize: 11.5, color: tokens.muted }}>
          {entries.length} lesson{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 10,
        }}
      >
        {entries.map((e) => (
          <LessonCard key={e.relPath} entry={e} now={now} />
        ))}
      </div>
    </section>
  );
}

function LessonCard({ entry, now }: { entry: TeachingUnitEntry; now: number }) {
  const verified = relativeTime(entry.lastVerifiedAt, now);
  return (
    <article
      className="cos-chip-hover"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: 13,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${LENS_TONES[entry.lens]}`,
        minWidth: 0,
      }}
    >
      <p
        title={entry.title}
        style={{
          margin: 0,
          fontSize: 13.5,
          fontWeight: 650,
          color: tokens.fg,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          lineHeight: 1.3,
        }}
      >
        {entry.title}
      </p>
      {/* Audience (intent) + publish (lifecycle) are the meaningful frontmatter
          facets. The LENS (which corpus dir) is already the card's left-border
          hue, so a lens pill here would just duplicate the audience word
          ("Internal" twice); we surface it only when it's actionable — an
          `unspecified` unit still needs the COS-2b migration. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Pill label={AUDIENCE_LABELS[entry.audience]} tone={AUDIENCE_TONES[entry.audience]} withDot />
        <Pill label={PUBLISH_LABELS[entry.publishState]} tone={PUBLISH_TONES[entry.publishState]} withDot />
      </div>
      {/* Lens as TEXT for every value (not color-only) — the left-border hue is a
          reinforcement, not the sole signal (WCAG 1.4.1) [codex-B P1]. `unspecified`
          reads "Unmigrated" in amber as the actionable migration-debt flag. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: tokens.muted, flexWrap: "wrap" }}>
        <span
          style={{ color: LENS_TONES[entry.lens], fontWeight: 600 }}
          title={entry.lens === "unspecified" ? "Pre-COS-2b unit — not yet split into an internal/external lens" : `${LENS_LABELS[entry.lens]} curriculum`}
        >
          {LENS_LABELS[entry.lens]}
        </span>
        <span aria-hidden="true">·</span>
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          <CheckIcon size={11} />
        </span>
        <span>{verified ? `verified ${verified}` : "not yet verified"}</span>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// empty corpus + scoped motion
// ---------------------------------------------------------------------------

function EmptyCorpus() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 20,
        border: `1px dashed ${tokens.border}`,
        borderRadius: tokens.radius,
        background: tokens.bg,
        color: tokens.muted,
        fontSize: 13,
      }}
    >
      <span aria-hidden="true" style={{ color: tokens.accent, display: "inline-flex" }}>
        <TeachingIcon size={20} />
      </span>
      <span>
        <strong style={{ color: tokens.fg, fontWeight: 600 }}>No teaching units yet.</strong> Lessons appear here once the
        Librarian synthesizes the inbox backlog into <code style={{ fontFamily: tokens.mono }}>docs/teachings/units</code>.
      </span>
    </div>
  );
}

/** Scoped critical-pulse keyframe (used only by the attention glyph); reduced-motion safe. */
function TeachingKeyframes() {
  return (
    <style
      id={TEACHING_STYLE_ID}
      dangerouslySetInnerHTML={{
        __html: `@keyframes cos-teach-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
.cos-teach-pulse{animation:cos-teach-pulse 1.8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.cos-teach-pulse{animation:none}}`,
      }}
    />
  );
}

