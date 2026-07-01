/**
 * `RoutineSloCard` — the ONE routine-SLO tile, shared by the standalone Routines
 * board (`variant="card"`, the full 3D tile with a verdict-tinted left accent)
 * and each AgentCard's owned-routines drawer (`variant="row"`, a compact
 * divider-separated line — dividers over card-in-card, per Joe's density rule).
 *
 * All display logic is the pure `computeRoutineSlo` fold; this file is render
 * only, SSR-faithful (no host bridge), so the Playwright harness screenshots the
 * exact live tree.
 */

import type { ReactNode } from "react";
import { tokens } from "../tokens.js";
import { Pill, Dot } from "./badges.js";
import { CheckIcon, ClockIcon, AlertIcon } from "../icons.js";
import { VERDICT_TONES } from "./verdict-labels.js";
import { computeRoutineSlo, type RoutineSloDisplay, type RoutineSloView } from "./routine-slo-view.js";

export interface RoutineSloCardProps {
  routine: RoutineSloView;
  now: number;
  /** `card` = the full standalone tile; `row` = the compact nested-in-AgentCard form. */
  variant?: "card" | "row";
}

export function RoutineSloCard({ routine, now, variant = "card" }: RoutineSloCardProps) {
  const d = computeRoutineSlo(routine, now);
  return variant === "row" ? <RoutineSloRow routine={routine} d={d} /> : <RoutineSloFullCard routine={routine} d={d} />;
}

// ---------------------------------------------------------------------------
// Card variant — the standalone Routines board tile (extracted verbatim from the
// former inline `RoutineCard`; every field/state preserved).
// ---------------------------------------------------------------------------

function RoutineSloFullCard({ routine, d }: { routine: RoutineSloView; d: RoutineSloDisplay }) {
  return (
    <article
      data-slo-variant="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: 14,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${d.tone}`,
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
          <p style={{ margin: "2px 0 0", fontSize: 11.5, color: tokens.muted, fontFamily: tokens.mono }}>{routine.cadence}</p>
        </div>
        <Pill label={d.verdictLabel} tone={d.tone} soft withDot />
      </div>

      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
        <MetaRow icon={<ClockIcon size={12} />} label="Last run" value={d.lastRun} />
        {d.next ? (
          <MetaRow
            icon={<ClockIcon size={12} />}
            label={d.next.label}
            value={d.next.value}
            iconTone={d.overdue ? VERDICT_TONES.missing : undefined}
          />
        ) : null}
        {d.artifact.kind === "embedded" ? (
          <MetaRow icon={<CheckIcon size={12} />} iconTone={d.tone} label="SLO" value="duties only" />
        ) : (
          <MetaRow
            icon={d.artifact.present ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
            iconTone={d.artifact.present ? VERDICT_TONES.fresh : VERDICT_TONES.missing}
            label={d.artifact.kind === "proposal" ? "Proposal" : "Artifact"}
            value={d.artifact.present ? "present" : "missing"}
          />
        )}
      </dl>

      <ReferenceLine reference={d.reference} />

      {routine.detail ? <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, lineHeight: 1.4 }}>{routine.detail}</p> : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Row variant — the compact form nested in an AgentCard's routines drawer.
// No card chrome; the drawer separates rows with dividers.
// ---------------------------------------------------------------------------

function RoutineSloRow({ routine, d }: { routine: RoutineSloView; d: RoutineSloDisplay }) {
  const facts: string[] = [routine.cadence, "last " + d.lastRun];
  if (d.next) facts.push(d.next.label.toLowerCase() + " " + d.next.value);
  facts.push(
    d.artifact.kind === "embedded" ? "duties only" : d.artifact.kind + (d.artifact.present ? " present" : " missing"),
  );

  return (
    <div data-slo-variant="row" style={{ display: "flex", flexDirection: "column", gap: 3, paddingBlock: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Dot tone={d.tone} />
        <span
          title={routine.displayName}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 600,
            color: tokens.fg,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {routine.displayName}
        </span>
        <Pill label={d.verdictLabel} tone={d.tone} soft withDot />
      </div>
      <p style={{ margin: 0, fontSize: 11, color: tokens.muted, lineHeight: 1.45 }}>{facts.join(" · ")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function ReferenceLine({ reference }: { reference: RoutineSloDisplay["reference"] }) {
  if (!reference) return null;
  if (reference.kind === "path") {
    return (
      <code
        title={reference.value}
        style={{
          fontFamily: tokens.mono,
          fontSize: 10.5,
          color: tokens.muted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {reference.value}
      </code>
    );
  }
  return (
    <code style={{ fontFamily: tokens.mono, fontSize: 10.5, color: tokens.muted, opacity: 0.7 }} title={reference.value}>
      {reference.value}
    </code>
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
