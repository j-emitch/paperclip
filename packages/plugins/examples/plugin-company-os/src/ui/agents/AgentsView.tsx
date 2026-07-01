/**
 * `AgentsView` — the pure Agents cockpit (spec §7, the D-14 elevation). Composes
 * the vitals masthead, the org constellation, the four-agent roster, coordination
 * intel (duty overlaps + the hand-off ledger), and the diagnostics rail into one
 * legible system. No SDK runtime — SSR-faithful (deterministic constellation,
 * injected `now`, selection via prop) so the Playwright harness screenshots the
 * exact live tree. Reuses the cockpit's shared tokens / cards / dividers; no
 * card-in-card.
 */

import type { AgentSystemV1, AgentSystemVitalsV1, RoutineVerdict } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { VERDICT_LABELS, VERDICT_TONES } from "../shared/verdict-labels.js";
import { AgentConstellation } from "./AgentConstellation.js";
import { AgentCard } from "./AgentCard.js";
import { OverlapCard } from "./OverlapCard.js";
import { HandoffLedger } from "./HandoffLedger.js";
import { DiagnosticsRail } from "./DiagnosticsRail.js";
import { buildAgentSystemVm, formatBudget, type AgentSystemVm } from "./agent-system-view.js";

export interface AgentsViewProps {
  system: AgentSystemV1;
  now: number;
  isMobile?: boolean;
  selectedAgentKey?: string | null;
  onSelectAgent?: (agentKey: string | null) => void;
}

/** Worst-first verdict order for the masthead breakdown (local — no routines-view coupling). */
const VERDICT_BREAKDOWN: readonly RoutineVerdict[] = ["missing", "stale", "never_ran", "fresh"];

export function AgentsView({ system, now, isMobile = false, selectedAgentKey = null, onSelectAgent }: AgentsViewProps) {
  const vm = buildAgentSystemVm(system);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      <Masthead vitals={vm.vitals} isMobile={isMobile} />

      {vm.hasAnyData ? (
        <div className="cos-fx-enter">
          <AgentConstellation
            agents={vm.agents}
            handoffs={vm.handoffs}
            selectedAgentKey={selectedAgentKey}
            onSelectAgent={onSelectAgent}
            isMobile={isMobile}
          />
        </div>
      ) : null}

      <Roster vm={vm} now={now} isMobile={isMobile} selectedAgentKey={selectedAgentKey} onSelectAgent={onSelectAgent} />

      <Coordination vm={vm} isMobile={isMobile} />

      <DiagnosticsRail diagnostics={vm.diagnostics} warnCount={vm.warnCount} infoCount={vm.infoCount} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masthead — the vitals at a glance.
// ---------------------------------------------------------------------------

function Masthead({ vitals, isMobile }: { vitals: AgentSystemVitalsV1; isMobile: boolean }) {
  const tiles: Array<{ value: string; label: string }> = [
    { value: String(vitals.agentCount), label: "Agents" },
    { value: vitals.routinesFreshPct + "%", label: "Routines fresh" },
    { value: formatBudget(vitals.budgetMonthlyCentsTotal), label: "Monthly budget" },
    { value: vitals.heartbeatCadence ?? "—", label: "Heartbeat" },
    { value: String(vitals.diagnosticsCount), label: "Diagnostics" },
  ];
  const breakdown = VERDICT_BREAKDOWN.filter((v) => vitals.verdictCounts[v] > 0);

  return (
    <header
      className="cos-fx-enter"
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
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: tokens.fg, letterSpacing: -0.2 }}>Agents</h2>
        <span style={{ fontSize: 12.5, color: tokens.muted }}>The four-agent workforce — duties, routine SLOs, and coordination health.</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
          gap: 10,
        }}
      >
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
            <span style={{ fontSize: 18, fontWeight: 700, color: tokens.fg, letterSpacing: -0.3 }}>{tile.value}</span>
            <span style={{ fontSize: 11, color: tokens.muted }}>{tile.label}</span>
          </div>
        ))}
      </div>

      {breakdown.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {breakdown.map((verdict) => (
            <Pill
              key={verdict}
              label={vitals.verdictCounts[verdict] + " " + VERDICT_LABELS[verdict].toLowerCase()}
              tone={VERDICT_TONES[verdict]}
              withDot
            />
          ))}
        </div>
      ) : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Roster — the workforce cards.
// ---------------------------------------------------------------------------

function Roster({
  vm,
  now,
  isMobile,
  selectedAgentKey,
  onSelectAgent,
}: {
  vm: AgentSystemVm;
  now: number;
  isMobile: boolean;
  selectedAgentKey: string | null;
  onSelectAgent?: (agentKey: string | null) => void;
}) {
  if (!vm.hasAnyData) {
    return <CalmNote>No agents are configured yet — add a company-os.json sidecar to each agent to light up the cockpit.</CalmNote>;
  }
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SectionHeading title="Workforce" note={vm.agents.length + " agents"} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 12,
        }}
      >
        {vm.agents.map((agent) => (
          <AgentCard
            key={agent.agentKey}
            agent={agent}
            hasModelDrift={vm.agentsWithModelDrift.has(agent.agentKey)}
            now={now}
            selected={agent.agentKey === selectedAgentKey}
            onSelect={onSelectAgent}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coordination — overlaps + hand-offs.
// ---------------------------------------------------------------------------

function Coordination({ vm, isMobile }: { vm: AgentSystemVm; isMobile: boolean }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SectionHeading title="Coordination" note={vm.overlaps.length + " overlaps · " + vm.handoffMismatchCount + " mismatches"} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? 12 : 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <SubHeading text="Duty overlaps" />
          {vm.overlaps.length === 0 ? (
            <CalmNote tone={tokens.muted}>No duty overlaps detected — clean ownership boundaries.</CalmNote>
          ) : (
            vm.overlaps.map((overlap) => <OverlapCard key={overlap.surface} overlap={overlap} />)
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <SubHeading text="Hand-offs" />
          <HandoffLedger handoffs={vm.handoffs} />
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>{title}</h3>
      <span style={{ fontSize: 11.5, color: tokens.muted }}>{note}</span>
    </div>
  );
}

function SubHeading({ text }: { text: string }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: tokens.muted }}>{text}</span>;
}
