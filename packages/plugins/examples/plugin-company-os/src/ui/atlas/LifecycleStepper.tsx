/**
 * `LifecycleStepper` — the Spec·Plan·Build·Prod lifecycle, rendered as four
 * connected pips. DECOUPLED from built-% by contract: a family can be `prod:
 * active` while `<100%` built (the rolling case), so the stepper reflects
 * lifecycle STAGE and the built bar (elsewhere on the card) reflects COMPLETION —
 * the two never contradict. A rolling family shows a "· live" tail instead of a
 * terminal state; a plan gap (`planState` none/partial) surfaces a pill.
 *
 * Pure + prop-driven, SSR-faithful (no host bridge, no clock): the Playwright
 * harness screenshots the exact live tree. Three sizes — `full` (expanded card),
 * `compact` (collapsed card summary), `mini` (a lineage node's at-a-glance
 * lifecycle). The whole stepper is one aria-group whose label reads every gate,
 * so a screen reader gets the lifecycle without seeing the pips.
 */

import type { CSSProperties } from "react";
import type { GateState, LifecycleV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { withAlpha } from "../shared/color.js";
import { CheckIcon } from "../icons.js";
import { GATE_LABELS, GATE_STATE_LABELS, LIFECYCLE_GATES, PLAN_GAP_LABELS } from "./atlas-view-model.js";

/** Each gate-state's tone — green done, signature-orange active, amber warn, muted todo.
 *  Exported so the Atlas legend decodes the pips with the exact same key. */
export const GATE_TONE: Record<GateState, string> = {
  done: statusColors.ship,
  active: tokens.accent,
  warn: statusColors.revise,
  todo: tokens.muted,
};

type StepperSize = "full" | "compact" | "mini";

const PIP_SIZE: Record<StepperSize, number> = { full: 18, compact: 14, mini: 9 };

export interface LifecycleStepperProps {
  lifecycle: LifecycleV1;
  /** Rolling programs render a "· live" tail rather than implying terminal completion. */
  isRolling?: boolean;
  size?: StepperSize;
}

export function LifecycleStepper({ lifecycle, isRolling = false, size = "full" }: LifecycleStepperProps) {
  const pip = PIP_SIZE[size];
  const showLabels = size === "full";
  const planGap = lifecycle.planState === "none" || lifecycle.planState === "partial" ? lifecycle.planState : null;

  const ariaLabel =
    "Lifecycle — " +
    LIFECYCLE_GATES.map((g) => `${GATE_LABELS[g]} ${GATE_STATE_LABELS[lifecycle[g]]}`).join(", ") +
    (isRolling ? ", rolling program (live)" : "") +
    (planGap ? `, ${PLAN_GAP_LABELS[planGap]}` : "");

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: "inline-flex", alignItems: showLabels ? "flex-start" : "center", gap: size === "mini" ? 3 : 6, minWidth: 0 }}
    >
      {LIFECYCLE_GATES.map((gate, i) => {
        const state = lifecycle[gate];
        const prev = i > 0 ? lifecycle[LIFECYCLE_GATES[i - 1]] : null;
        return (
          <div key={gate} style={{ display: "flex", alignItems: "center", gap: size === "mini" ? 3 : 6, minWidth: 0 }}>
            {i > 0 ? <Track reached={prev === "done"} size={size} /> : null}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
              <Pip state={state} size={pip} />
              {showLabels ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: state === "todo" ? 500 : 600,
                    letterSpacing: 0.2,
                    color: state === "todo" ? tokens.muted : GATE_TONE[state],
                    whiteSpace: "nowrap",
                  }}
                >
                  {GATE_LABELS[gate]}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {isRolling ? <LiveTail size={size} /> : null}
      {planGap && size !== "mini" ? <PlanGapPill state={planGap} /> : null}
    </div>
  );
}

/** A single gate pip — filled ring in its tone; `done` carries a check, `todo` is a hollow ring. */
function Pip({ state, size }: { state: GateState; size: number }) {
  const tone = GATE_TONE[state];
  const filled = state === "done" || state === "active" || state === "warn";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        border: `${state === "todo" ? 1.5 : 1}px solid ${state === "todo" ? tokens.border : tone}`,
        background: filled ? withAlpha(tone, state === "active" ? 0.9 : 0.85) : "transparent",
        color: state === "done" ? tokens.bg : tone,
        boxShadow: state === "active" ? `0 0 0 3px ${withAlpha(tone, 0.16)}` : "none",
      }}
    >
      {state === "done" && size >= 14 ? <CheckIcon size={Math.round(size * 0.62)} strokeWidth={2.6} /> : null}
    </span>
  );
}

/** The connector between two pips — tinted "reached" (green) once the prior gate is done. */
function Track({ reached, size }: { reached: boolean; size: StepperSize }) {
  const width = size === "mini" ? 6 : size === "compact" ? 12 : 16;
  return (
    <span
      aria-hidden="true"
      style={{
        width,
        height: 2,
        borderRadius: 999,
        background: reached ? withAlpha(statusColors.ship, 0.7) : tokens.border,
        // Nudge the connector up so it aligns with the pip centre, not the label row.
        alignSelf: size === "full" ? "flex-start" : "center",
        marginTop: size === "full" ? PIP_SIZE[size] / 2 - 1 : 0,
        flex: "0 0 auto",
      }}
    />
  );
}

/** The rolling-program tail — "· live", the same phrasing as the built bar. */
function LiveTail({ size }: { size: StepperSize }) {
  if (size === "mini") {
    return (
      <span
        aria-hidden="true"
        title="rolling program — live"
        style={{ width: 5, height: 5, borderRadius: 999, background: statusColors.live, marginLeft: 2, flex: "0 0 auto" }}
      />
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 6,
        alignSelf: size === "full" ? "flex-start" : "center",
        marginTop: size === "full" ? 1 : 0,
        fontSize: 10.5,
        fontWeight: 600,
        color: statusColors.live,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: statusColors.live }} />
      live
    </span>
  );
}

/** The plan-gap pill — a soft amber flag when a spec exists but the plan is missing/partial. */
function PlanGapPill({ state }: { state: "none" | "partial" }) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
    alignSelf: "flex-start",
    marginTop: 1,
    padding: "1px 7px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.2,
    color: statusColors.revise,
    background: withAlpha(statusColors.revise, 0.14),
    border: `1px solid ${withAlpha(statusColors.revise, 0.42)}`,
    whiteSpace: "nowrap",
  };
  return (
    <span style={style} title={state === "none" ? "A spec exists but no plan is authored yet" : "The plan covers less than the spec's ticket surface"}>
      {PLAN_GAP_LABELS[state]}
    </span>
  );
}
