/**
 * Pure per-routine display fold for the shared `RoutineSloCard`.
 *
 * Both the full-tile `card` variant AND each AgentCard's owned-routines drawer
 * (`row` variant — the live Agents-cockpit form) render the same routine SLO, so the field
 * set + the overdue/verdict/artifact derivation live here exactly once —
 * decoupled from BOTH the `RoutineHealthEntry` and the `RoutineSloEntryV1`
 * contracts (either structurally satisfies `RoutineSloView`). Pure fn of an
 * injected `now`, so it's deterministic under SSR + unit test.
 */

import type { FreshnessKind, RoutineVerdict } from "../../contracts/index.js";
import { relativeTime, relativeFromNow } from "./time.js";
import { labelForNullableVerdict, toneForNullableVerdict } from "./verdict-labels.js";

/**
 * The exact fields the SLO card renders — a structural subset that both
 * `RoutineHealthEntry` and `RoutineSloEntryV1` satisfy (they carry extra fields
 * like `ownerAgent`/`latestArtifactMtime` the card doesn't render).
 */
export interface RoutineSloView {
  routineKey: string;
  displayName: string;
  cadence: string;
  freshnessKind: FreshnessKind;
  expectedArtifactGlob: string;
  lastRunAt: string | null;
  nextExpectedAt: string | null;
  expectedArtifactPresent: boolean;
  latestArtifactPath: string | null;
  verdict: RoutineVerdict | null;
  detail: string | null;
}

/** The artifact/proposal/embedded status row a card renders. */
export type RoutineArtifactState =
  | { kind: "embedded" }
  | { kind: "artifact" | "proposal"; present: boolean };

/** The path-or-glob provenance line, or `null` when neither is known. */
export type RoutineReference =
  | { kind: "path"; value: string }
  | { kind: "glob"; value: string }
  | null;

export interface RoutineSloDisplay {
  /** Verdict tone (drives the left accent + the verdict pill). */
  tone: string;
  /** "Fresh" | "Stale" | "Missing" | "Never ran" | "Duties only". */
  verdictLabel: string;
  /** Compact last-run ("3h ago") or "never". */
  lastRun: string;
  /** Next-expected countdown, or the Overdue callout; `null` when uncomputable. */
  next: { label: "Next" | "Overdue"; value: string } | null;
  /** True when `nextExpectedAt` is in the past. */
  overdue: boolean;
  artifact: RoutineArtifactState;
  reference: RoutineReference;
}

export function computeRoutineSlo(routine: RoutineSloView, now: number): RoutineSloDisplay {
  const nextMs = routine.nextExpectedAt ? Date.parse(routine.nextExpectedAt) : NaN;
  const overdue = Number.isFinite(nextMs) && nextMs < now;
  // A past `nextExpectedAt` reads as "Overdue" (the elapsed-since form) rather
  // than a contradictory forward countdown; a future one reads "in 3h".
  const nextValue = overdue ? relativeTime(routine.nextExpectedAt, now) : relativeFromNow(routine.nextExpectedAt, now);

  const artifact: RoutineArtifactState =
    routine.freshnessKind === "embedded"
      ? { kind: "embedded" }
      : { kind: routine.freshnessKind === "proposal" ? "proposal" : "artifact", present: routine.expectedArtifactPresent };

  const reference: RoutineReference = routine.latestArtifactPath
    ? { kind: "path", value: routine.latestArtifactPath }
    : routine.expectedArtifactGlob
      ? { kind: "glob", value: routine.expectedArtifactGlob }
      : null;

  return {
    tone: toneForNullableVerdict(routine.verdict),
    verdictLabel: labelForNullableVerdict(routine.verdict),
    lastRun: relativeTime(routine.lastRunAt, now) ?? "never",
    next: nextValue ? { label: overdue ? "Overdue" : "Next", value: nextValue } : null,
    overdue,
    artifact,
    reference,
  };
}
