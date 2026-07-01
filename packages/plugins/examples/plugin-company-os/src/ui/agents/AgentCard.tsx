/**
 * `AgentCard` — one agent in the cockpit roster (spec §7.3). Sigil + name + role +
 * a health-rollup pill; a row of identity chips (model + drift, budget, heartbeat,
 * reporting line, agent-creation authority, turn cap); the agent's de-duped duties;
 * and a native `<details>` drawer of its owned routines rendered as nested
 * `RoutineSloCard` rows (dividers, not card-in-card). The header is a select
 * button — a sibling of the drawer, never wrapping it, so the a11y tree is valid.
 */

import type { AgentCardV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill, Dot } from "../shared/badges.js";
import { CaretIcon } from "../icons.js";
import { RoutineSloCard } from "../shared/RoutineSloCard.js";
import { labelForNullableVerdict, toneForNullableVerdict } from "../shared/verdict-labels.js";
import { dutiesForDisplay, formatBudget } from "./agent-system-view.js";

export interface AgentCardProps {
  agent: AgentCardV1;
  hasModelDrift: boolean;
  now: number;
  selected?: boolean;
  onSelect?: (agentKey: string | null) => void;
}

function heartbeatLabel(sec: number | null): string | null {
  if (sec === null) return null;
  if (sec === 86_400) return "daily";
  if (sec === 3_600) return "hourly";
  return sec + "s";
}

export function AgentCard({ agent, hasModelDrift, now, selected = false, onSelect }: AgentCardProps) {
  const duties = dutiesForDisplay(agent);
  const rollupTone = toneForNullableVerdict(agent.healthRollup);
  const rollupLabel = labelForNullableVerdict(agent.healthRollup);
  const sloRoutines = agent.ownedRoutines.filter((r) => r.freshnessKind !== "embedded");
  const heartbeat = heartbeatLabel(agent.heartbeatIntervalSec);
  const clickable = typeof onSelect === "function";

  return (
    <article
      data-agent={agent.agentKey}
      data-selected={selected ? "true" : undefined}
      className="cos-fx-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 11,
        padding: 15,
        background: tokens.card,
        border: `1px solid ${selected ? tokens.accentBorder : tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${rollupTone}`,
        minWidth: 0,
      }}
    >
      <HeaderButton
        agent={agent}
        rollupTone={rollupTone}
        rollupLabel={rollupLabel}
        selected={selected}
        clickable={clickable}
        onSelect={onSelect}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Pill label={agent.model} tone={tokens.muted} title="Config model — verify against the live Paperclip runtime before treating it as burn data." />
        {hasModelDrift ? (
          <Pill
            label="drift"
            tone={tokens.accent}
            soft
            withDot
            title="This agent's config model may differ from its live runtime model — verify before treating config as burn."
          />
        ) : null}
        <Pill label={formatBudget(agent.budgetMonthlyCents)} tone={tokens.muted} title="Configured monthly budget" />
        {heartbeat ? <Pill label={"beats " + heartbeat} tone={tokens.muted} title="Heartbeat cadence" /> : null}
        {agent.reportsTo ? <Pill label={"reports to " + agent.reportsTo} tone={tokens.muted} /> : <Pill label="apex" tone={tokens.accent} soft />}
        {agent.canCreateAgents ? <Pill label="creates agents" tone={tokens.accent} soft withDot title="Authorized to spin up sub-agents" /> : null}
        {agent.maxTurnsPerRun !== null ? <Pill label={agent.maxTurnsPerRun + " turns"} tone={tokens.muted} title="Max turns per run" /> : null}
      </div>

      {agent.summary ? <p style={{ margin: 0, fontSize: 12, color: tokens.muted, lineHeight: 1.45 }}>{agent.summary}</p> : null}

      <DutiesRow duties={duties} />

      <RoutinesDrawer sloRoutines={sloRoutines} rollupTone={rollupTone} rollupLabel={rollupLabel} now={now} defaultOpen={selected} />
    </article>
  );
}

function HeaderButton({
  agent,
  rollupTone,
  rollupLabel,
  selected,
  clickable,
  onSelect,
}: {
  agent: AgentCardV1;
  rollupTone: string;
  rollupLabel: string;
  selected: boolean;
  clickable: boolean;
  onSelect?: (agentKey: string | null) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={clickable ? selected : undefined}
      onClick={clickable ? () => onSelect?.(selected ? null : agent.agentKey) : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: 0,
        border: "none",
        background: "transparent",
        font: "inherit",
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        width: "100%",
        color: tokens.fg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 38,
          height: 38,
          borderRadius: 999,
          flex: "0 0 auto",
          fontSize: 13.5,
          fontWeight: 700,
          color: tokens.fg,
          background: tokens.cardElevated,
          border: `2px solid ${rollupTone}`,
        }}
      >
        {agent.displayName.slice(0, 2)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: tokens.fg }}>{agent.displayName}</span>
          <span style={{ fontSize: 11.5, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.4, fontFamily: tokens.mono }}>
            {agent.role}
          </span>
        </span>
      </span>
      <Pill label={rollupLabel} tone={rollupTone} soft withDot />
    </button>
  );
}

function DutiesRow({ duties }: { duties: ReturnType<typeof dutiesForDisplay> }) {
  if (duties.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: tokens.muted }}>Duties</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {duties.map((duty) => (
          <span
            key={duty.kind + ":" + duty.id}
            title={duty.surface ?? undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 7,
              fontSize: 11.5,
              color: tokens.fg,
              background: tokens.secondary,
              border: `1px solid ${tokens.border}`,
            }}
          >
            {duty.kind === "embedded-routine" ? <Dot tone={tokens.accent} size={6} /> : null}
            {duty.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoutinesDrawer({
  sloRoutines,
  rollupTone,
  rollupLabel,
  now,
  defaultOpen,
}: {
  sloRoutines: AgentCardV1["ownedRoutines"];
  rollupTone: string;
  rollupLabel: string;
  now: number;
  defaultOpen: boolean;
}) {
  const count = sloRoutines.length;
  return (
    <details open={defaultOpen || undefined} style={{ marginTop: 2 }}>
      <summary
        className="cos-fx-summary"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          listStyle: "none",
          cursor: "pointer",
          fontSize: 12.5,
          color: tokens.fg,
        }}
      >
        <span aria-hidden="true" className="cos-fx-caret" style={{ display: "inline-flex", color: tokens.muted }}>
          <CaretIcon size={13} />
        </span>
        <span style={{ fontWeight: 600 }}>
          {count} routine{count === 1 ? "" : "s"}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Pill label={rollupLabel} tone={rollupTone} soft withDot />
        </span>
      </summary>
      <div className="cos-fx-drawer-body" style={{ marginTop: 6 }}>
        {count === 0 ? (
          <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, padding: "6px 0" }}>Duties only — no standalone SLO routines.</p>
        ) : (
          sloRoutines.map((routine, i) => (
            <div key={routine.routineKey} style={{ borderTop: i > 0 ? `1px solid ${tokens.border}` : undefined }}>
              <RoutineSloCard routine={routine} now={now} variant="row" />
            </div>
          ))
        )}
      </div>
    </details>
  );
}
