/**
 * `readTeachingOverview` — the worker side of the Teaching tab's `teaching-overview`
 * data handler (COS-2f). Like `report-content`, it is read LIVE per request (no
 * cached `cos_teaching_*` row — deferred to COS-3), and it is deliberately PURE
 * over injected deps (a bundle collector + a clock) so the whole read path is
 * unit-testable without a filesystem or the SDK runtime.
 *
 * The worker wires `collectBundle` to run the `TeachingSource` against a live
 * `CollectionContext` (full sweep), then this folds the bundle through
 * `deriveTeachingOverview` and VALIDATES the result before it crosses the bridge —
 * a malformed payload throws here rather than reaching the browser.
 */

import type { SignalBundle } from "./contracts/WorkSignalSource.js";
import { parseTeachingOverviewV1, type TeachingOverviewV1 } from "./contracts/teaching.js";
import { deriveTeachingOverview } from "./projections/deriveTeachingOverview.js";

export interface TeachingOverviewDeps {
  /** Collect a teaching `SignalBundle` (the worker runs `TeachingSource` for this). */
  collectBundle: () => Promise<SignalBundle>;
  /** Wall clock (epoch ms) — injected so `derivedAt` + age math are deterministic in tests. */
  now: () => number;
}

export async function readTeachingOverview(deps: TeachingOverviewDeps): Promise<TeachingOverviewV1> {
  const bundle = await deps.collectBundle();
  return parseTeachingOverviewV1(deriveTeachingOverview(bundle, deps.now()));
}
