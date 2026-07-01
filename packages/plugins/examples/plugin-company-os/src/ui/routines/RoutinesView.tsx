/**
 * Pure view for the Routines tab — the report-routine SLO board. Renders, per
 * owning agent (CEO / COO / CTO / Librarian), each routine's verdict, cadence,
 * last run, next-expected run, and whether its expected artifact is present, via
 * the shared `RoutineSloCard` (also nested inside the Agents cockpit's AgentCard
 * drawers, so a routine reads identically in both places). A summary bar tallies
 * the verdicts worst-first. No SDK runtime — SSR-faithful, so the Playwright
 * harness screenshots the exact live tree.
 */

import type { RoutineHealthV1, SourceFreshness } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { RoutineSloCard } from "../shared/RoutineSloCard.js";
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
        <p style={{ margin: 0, fontSize: 13, color: tokens.muted }}>No routine contracts found yet.</p>
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
          <RoutineSloCard key={r.routineKey} routine={r} now={now} variant="card" />
        ))}
      </div>
    </section>
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
