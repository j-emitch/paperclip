/**
 * Shared routine-verdict display vocabulary (keyed off the contract `RoutineVerdict`
 * tuple). Both the Agents cockpit AND the Home pinned-briefing render a routine's
 * SLO verdict, so the label + tone maps live here — neither surface depends on the
 * other (they live here, not in a view-model, so neither couples to the other; codex B), and a "fresh"
 * verdict reads the same green on both. Tones map onto the shared status palette.
 */

import type { RoutineVerdict } from "../../contracts/index.js";
import { statusColors } from "../tokens.js";

export const VERDICT_LABELS: Record<RoutineVerdict, string> = {
  fresh: "Fresh",
  stale: "Stale",
  missing: "Missing",
  never_ran: "Never ran",
};

export const VERDICT_TONES: Record<RoutineVerdict, string> = {
  fresh: statusColors.live,
  stale: statusColors.cached,
  missing: statusColors.danger,
  never_ran: statusColors.reviewUnknown,
};

export type NullableRoutineVerdict = RoutineVerdict | null;

export function labelForNullableVerdict(verdict: NullableRoutineVerdict): string {
  return verdict === null ? "Duties only" : VERDICT_LABELS[verdict];
}

export function toneForNullableVerdict(verdict: NullableRoutineVerdict): string {
  return verdict === null ? statusColors.reviewUnknown : VERDICT_TONES[verdict];
}
