/**
 * `collectAndProject` — the PURE projection step (spec §6). Takes an
 * already-assembled `SignalBundle` (from `collect`, possibly scope-merged with
 * last-good per-source snapshots) + an injected `nowMs`, and folds it into the
 * three persisted projection contracts. No ctx, no I/O, no clock of its own —
 * which is exactly why the COS-0d worker can run it deterministically under the
 * cache lock and the golden tests can pin its output.
 */

import type { SignalBundle } from "./contracts/WorkSignalSource.js";
import type { BoardStateV1 } from "./contracts/board-state.js";
import type { ArtifactIndexV1 } from "./contracts/artifact-index.js";
import type { RoutineHealthV1 } from "./contracts/routine-health.js";
import { deriveBoardState } from "./projections/deriveBoardState.js";
import { deriveArtifactIndex } from "./projections/deriveArtifactIndex.js";
import { deriveRoutineHealth } from "./projections/deriveRoutineHealth.js";

/** The full set of projections one derive produces — what the worker persists per company. */
export interface ProjectionSet {
  readonly board: BoardStateV1;
  readonly artifactIndex: ArtifactIndexV1;
  readonly routineHealth: RoutineHealthV1;
}

/** Fold a collected (+ optionally scope-merged) bundle into all three projections. */
export function collectAndProject(bundle: SignalBundle, nowMs: number): ProjectionSet {
  return {
    board: deriveBoardState(bundle, nowMs),
    artifactIndex: deriveArtifactIndex(bundle, nowMs),
    routineHealth: deriveRoutineHealth(bundle, nowMs),
  };
}
