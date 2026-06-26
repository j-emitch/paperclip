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
import type { ProjectTaxonomyV1 } from "./contracts/projects.js";
import type { OrientationV1 } from "./contracts/orientation.js";
import type { GitStateV1 } from "./contracts/git-state.js";
import type { DocIndexV1 } from "./contracts/doc-index.js";
import { deriveBoardState } from "./projections/deriveBoardState.js";
import { deriveArtifactIndex } from "./projections/deriveArtifactIndex.js";
import { deriveRoutineHealth } from "./projections/deriveRoutineHealth.js";
import { deriveOrientation } from "./projections/deriveOrientation.js";
import { deriveGitState } from "./projections/deriveGitState.js";
import { deriveDocIndex } from "./projections/deriveDocIndex.js";

/** The full set of projections one derive produces — what the worker persists per company. */
export interface ProjectionSet {
  readonly board: BoardStateV1;
  readonly artifactIndex: ArtifactIndexV1;
  readonly routineHealth: RoutineHealthV1;
  readonly orientation: OrientationV1;
  readonly gitState: GitStateV1;
  readonly docIndex: DocIndexV1;
}

/**
 * Fold a collected (+ optionally scope-merged) bundle into all six projections.
 * The COS-0 three keep their `(bundle, nowMs)` signature; the COS-1 three receive
 * the `taxonomy` (resolved once in `derive.ts`, PF-5) as the project-grouping lens
 * — a REQUIRED param (a default would silently mis-group).
 */
export function collectAndProject(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): ProjectionSet {
  return {
    board: deriveBoardState(bundle, nowMs),
    artifactIndex: deriveArtifactIndex(bundle, nowMs),
    routineHealth: deriveRoutineHealth(bundle, nowMs),
    orientation: deriveOrientation(bundle, nowMs, taxonomy),
    gitState: deriveGitState(bundle, nowMs, taxonomy),
    docIndex: deriveDocIndex(bundle, nowMs, taxonomy),
  };
}
