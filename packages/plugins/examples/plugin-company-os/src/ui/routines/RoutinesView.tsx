/**
 * Pure view for the Routines tab — the report-routine SLO board. Renders, per
 * owning agent (CEO / COO / CTO / Librarian), each routine's verdict, cadence,
 * last run, next-expected run, and whether its expected artifact is present. A
 * summary bar tallies the verdicts worst-first. No SDK runtime — SSR-faithful, so
 * the Playwright harness screenshots the exact live tree.
 */

import type { ReactNode } from "react";
import type { RoutineHealthEntry, RoutineHealthV1, SourceFreshness } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CheckIcon, ClockIcon, AlertIcon } from "../icons.js";
import { relativeTime, relativeFromNow } from "../shared/time.js";
import {
  buildRoutinesView,
  VERDICT_LABELS,
  VERDICT_ORDER,
  VERDICT_TONES,
  type AgentGroup,
} from "./routines-view-model.js";

export interface RoutinesViewProps {
  health: RoutineHealthV1;
  now: number;
  isMobile?: boolean;
}

export function RoutinesView({ health, now, isMobile = false }: RoutinesViewProps) {
  const view = buildRoutinesView(health);
  const stale = health.sources.filter((s) => s.freshness !== "live");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Routines</h2>
        <span style={{ fontSize: 12.5, color: tokens.muted }}>
          {view.total} routine{view.total === 1 ? "" : "s"} · {view.healthyPct}% fresh
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {VERDICT_ORDER.filter((v) => view.counts[v] > 0).map((v) => (
            <Pill key={v} label={`${view.counts[v]} ${VERDICT_LABELS[v].toLowerCase()}`} tone={VERDICT_TONES[v]} withDot />
          ))}
          {stale.map((s) => (
            <StalePill key={`${s.source}:${s.repo}`} source={s} />
          ))}
        </div>
      </header>

      {view.groups.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: tokens.muted }}>
          No routine contracts found yet — they’re read from each agent’s <code style={{ fontFamily: tokens.mono }}>company_os</code> block.
        </p>
      ) : (
        view.groups.map((group) => <AgentSection key={group.ownerAgent} group={group} now={now} isMobile={isMobile} />)
      )}
    </div>
  );
}

function AgentSection({ group, now, isMobile }: { group: AgentGroup; now: number; isMobile: boolean }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>
          {group.ownerAgent}
        </h3>
        <span style={{ fontSize: 11.5, color: tokens.muted }}>
          {group.routines.length} routine{group.routines.length === 1 ? "" : "s"}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 10,
        }}
      >
        {group.routines.map((r) => (
          <RoutineCard key={r.routineKey} routine={r} now={now} />
        ))}
      </div>
    </section>
  );
}

function RoutineCard({ routine, now }: { routine: RoutineHealthEntry; now: number }) {
  const tone = VERDICT_TONES[routine.verdict];
  const lastRun = relativeTime(routine.lastRunAt, now);
  // A past `nextExpectedAt` means the routine is overdue — label it as such rather
  // than rendering a contradictory "Next: 6d ago".
  const nextMs = routine.nextExpectedAt ? Date.parse(routine.nextExpectedAt) : NaN;
  const overdue = Number.isFinite(nextMs) && nextMs < now;
  const nextLabel = overdue ? "Overdue" : "Next";
  const nextValue = overdue ? relativeTime(routine.nextExpectedAt, now) : relativeFromNow(routine.nextExpectedAt, now);
  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: 14,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${tone}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            title={routine.displayName}
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
            {routine.displayName}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: tokens.muted, fontFamily: tokens.mono }}>
            {routine.cadence}
          </p>
        </div>
        <Pill label={VERDICT_LABELS[routine.verdict]} tone={tone} soft withDot />
      </div>

      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
        <MetaRow icon={<ClockIcon size={12} />} label="Last run" value={lastRun ?? "never"} />
        {nextValue ? <MetaRow icon={<ClockIcon size={12} />} label={nextLabel} value={nextValue} iconTone={overdue ? VERDICT_TONES.missing : undefined} /> : null}
        <MetaRow
          icon={routine.expectedArtifactPresent ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
          iconTone={routine.expectedArtifactPresent ? VERDICT_TONES.fresh : VERDICT_TONES.missing}
          label="Artifact"
          value={routine.expectedArtifactPresent ? "present" : "missing"}
        />
      </dl>

      {routine.latestArtifactPath ? (
        <code
          title={routine.latestArtifactPath}
          style={{
            fontFamily: tokens.mono,
            fontSize: 10.5,
            color: tokens.muted,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {routine.latestArtifactPath}
        </code>
      ) : (
        <code style={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.muted, opacity: 0.7 }} title={routine.expectedArtifactGlob}>
          {routine.expectedArtifactGlob}
        </code>
      )}

      {routine.detail ? <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, lineHeight: 1.4 }}>{routine.detail}</p> : null}
    </article>
  );
}

function MetaRow({ icon, iconTone, label, value }: { icon: ReactNode; iconTone?: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden="true" style={{ display: "inline-flex", color: iconTone ?? tokens.muted }}>
        {icon}
      </span>
      <dt style={{ color: tokens.muted, margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, marginLeft: "auto", color: tokens.fg, fontWeight: 550 }}>{value}</dd>
    </div>
  );
}

function StalePill({ source }: { source: SourceFreshness }) {
  return (
    <Pill
      label={`${source.source} stale`}
      tone={tokens.muted}
      withDot
      title={source.message ?? `${source.source} · ${source.repo} is ${source.freshness}`}
    />
  );
}
