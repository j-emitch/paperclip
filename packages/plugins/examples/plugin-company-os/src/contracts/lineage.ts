/**
 * The declarative Build-Atlas lineage layer + its loader seam (COS-5, spec §5).
 *
 * The lineage graph lives in the COMPANY repo as `config/build-atlas-lineage.json`
 * with ONE dependency-free parser/validator `config/lib/build-atlas-lineage.mjs`
 * — the EXACT mirror of the prefix-registry seam (`registry.ts` +
 * `prefix-registry.mjs`). Same "one loader, no drift" rule: `LineageSource` reads
 * it ONLY through this injected `LineageLoader`, never a second hardcoded graph.
 *
 * To keep `LineageSource` pure + unit-testable (no dynamic `import()` of an
 * absolute cross-repo path inside the source), the loader is injected on the
 * `CollectionContext` (`ctx.lineage`): the runtime adapter
 * (`makeCollectionContext`) implements it by dynamic-importing the real
 * `build-atlas-lineage.mjs`; fixtures implement it with canned graphs. The loader
 * MUST NOT throw — a broken graph returns `{ data: null, errors: [...] }` so the
 * Atlas degrades to no-lineage rather than crashing.
 */

import type { LineageEdge, LineageLaneGroup, SignalError } from "./signals.js";

/** The whole parsed lineage graph — lane-groups + cross-family edges. */
export interface LineageData {
  readonly laneGroups: readonly LineageLaneGroup[];
  readonly edges: readonly LineageEdge[];
}

/** What a `LineageLoader.load()` returns — the graph (or null) + any non-fatal problems. */
export interface LineageLoadResult {
  /** The validated graph; null when the load failed (see `errors`). */
  readonly data: LineageData | null;
  /** Non-fatal problems (missing file, no export, parse/validation failure); never thrown. */
  readonly errors: readonly SignalError[];
}

/**
 * The injected seam that yields the canonical lineage graph. The real adapter
 * wires this to the company repo's `build-atlas-lineage.mjs`; fixtures provide
 * canned results. MUST NOT throw.
 */
export interface LineageLoader {
  load(): Promise<LineageLoadResult>;
}
