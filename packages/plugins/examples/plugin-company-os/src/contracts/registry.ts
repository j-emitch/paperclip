/**
 * The canonical prefix-registry shape + its loader seam.
 *
 * The registry itself lives in the COMPANY repo as `config/prefix-registry.json`
 * with ONE dependency-free parser/validator `config/lib/prefix-registry.mjs`
 * (spec §8). The whole-system rule is "one taxonomy, no drift": the worker's
 * `PrefixRegistrySource`, the board derivation, the commit-msg/spec advisory,
 * and the future COS-2 classifier all read it through THAT parser — never a
 * second hardcoded map (the COS-0h grep-test enforces this).
 *
 * To keep `PrefixRegistrySource` pure + unit-testable (no dynamic `import()` of
 * an absolute cross-repo path inside the source), the loader is injected on the
 * `CollectionContext`: the COS-0c adapter implements `RegistryLoader` by
 * dynamic-importing the real `prefix-registry.mjs`; fixture tests implement it
 * with canned entries. The source maps `RegistryEntry[]` → `TaxonomySignal[]`
 * and turns a load failure into a degraded signal, never a throw.
 */

import type { SignalError } from "./signals.js";

/**
 * One row of the canonical registry — the EXACT shape of a
 * `config/prefix-registry.json` entry (spec §8). `l2_subsystem` and `created_at`
 * are nullable in the JSON; everything else is required.
 */
export interface RegistryEntry {
  readonly prefix: string;
  readonly family: string;
  readonly l1_system: string;
  readonly l2_subsystem: string | null;
  readonly description: string;
  readonly is_generic: boolean;
  /** ISO calendar date the prefix was registered, or null for grandfathered rows. */
  readonly created_at: string | null;
}

/** What a `RegistryLoader.load()` returns — entries + any non-fatal load problems. */
export interface RegistryLoadResult {
  /** Validated registry rows (empty when the load failed — see `errors`). */
  readonly entries: readonly RegistryEntry[];
  /** Non-fatal problems (missing file, parse/validation failure); never thrown. */
  readonly errors: readonly SignalError[];
}

/**
 * The injected seam that yields the canonical registry. The real adapter wires
 * this to the company repo's `prefix-registry.mjs` (the single source of truth);
 * fixtures provide canned results. MUST NOT throw — a broken registry returns
 * `{ entries: [], errors: [...] }` so the board degrades gracefully.
 */
export interface RegistryLoader {
  load(): Promise<RegistryLoadResult>;
}
