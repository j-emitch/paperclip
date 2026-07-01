/**
 * `grouping.ts` — the SINGLE grouping resolver (COS-5g, two-lens reconciliation).
 *
 * The cockpit had TWO grouping lenses that computed independently and could drift:
 *   - the PREFIX lens: ticket-prefix → L1:L2 family/lane, built from
 *     `TaxonomySignal`s (`company/config/prefix-registry.json`). This was
 *     DUPLICATED verbatim as a local `buildTaxonomy` + `Taxon` interface in BOTH
 *     `deriveBoardState` and `deriveBuildAtlas`.
 *   - the REPO lens: repo → project group (Company / Juice Bar / …), owned by
 *     `projects.ts` (`projectKeyForRepo` / `ProjectTaxonomyV1`), consumed by
 *     `deriveGitState` (section iteration) + `deriveOrientation` (per-item badge).
 *
 * 5g unifies grouping behind THIS module. The prefix lens lives here ONCE
 * (`buildPrefixGrouping` / `resolveGrouping`), and the repo lens is re-exported
 * here (`repoBadge`) so every projection + UI reads grouping from one import
 * site — "one grouping path, no drift" (the symmetric analogue of the registry's
 * "one taxonomy, no drift").
 *
 * `projects.ts` REMAINS the repo→project ENGINE: its `ProjectTaxonomyV1` group
 * structure (roles / order / kind / displayName) is load-bearing for
 * `deriveGitState`'s section rendering and is NOT flattened into `{l1,l2,domain}`.
 * The plan's "`projects.ts` demoted to repo-badge only" is realized as: grouping
 * CONSUMERS reach the repo lens through this facade; the engine is unchanged.
 *
 * Behaviour-preserving: `buildPrefixGrouping` returns the SAME `${l1}:${l2}`
 * grouping the two `buildTaxonomy` copies computed. The only functional changes
 * are (1) the reconciled family set (5g.2 registry extension) flows through
 * automatically, and (2) `isRolling` is now sourced from the registry rather than
 * a hardcoded set in `deriveBuildAtlas` (its durable home — 5g).
 */

import type { TaxonomySignal } from "./signals.js";
import { projectKeyForRepo, type ProjectTaxonomyV1 } from "./projects.js";

/**
 * One resolved prefix-family grouping — the unified successor of the two
 * per-projection `Taxon` interfaces (Board's `{l1System,l2Subsystem}` +
 * Atlas's `{l1,l2}`), normalized to the Atlas's `{l1,l2}` naming.
 */
export interface GroupingEntry {
  readonly prefix: string;
  readonly family: string;
  /** L1 system (also the Atlas top-level "domain"). */
  readonly l1: string;
  /** L2 subsystem — defaulted to "General" when the registry leaves it null. */
  readonly l2: string;
  /** `${l1}:${l2}` — the board/atlas lane id. */
  readonly laneId: string;
  readonly isGeneric: boolean;
  /** Continuously-shipping program → the built bar reads "· live" (registry-sourced, 5g). */
  readonly isRolling: boolean;
}

/**
 * Build the prefix→grouping map from `TaxonomySignal`s — the ONE prefix lens
 * (replaces `deriveBoardState.buildTaxonomy` + `deriveBuildAtlas.buildTaxonomy`).
 * Last-wins on a duplicate prefix, matching the prior `Map.set` behaviour.
 */
export function buildPrefixGrouping(taxa: readonly TaxonomySignal[]): Map<string, GroupingEntry> {
  const map = new Map<string, GroupingEntry>();
  for (const t of taxa) {
    const l2 = t.l2Subsystem ?? "General";
    map.set(t.prefix, {
      prefix: t.prefix,
      family: t.family,
      l1: t.l1System,
      l2,
      laneId: `${t.l1System}:${l2}`,
      isGeneric: t.isGeneric,
      isRolling: t.isRolling,
    });
  }
  return map;
}

/**
 * Resolve a single prefix's grouping, or `null` when the prefix is unregistered
 * (the Board routes those to its Ops lane; the Atlas surfaces an unknown_prefix
 * diagnostic). A `null` prefix (unparsed work) resolves to `null` too.
 */
export function resolveGrouping(
  grouping: ReadonlyMap<string, GroupingEntry>,
  prefix: string | null,
): GroupingEntry | null {
  return prefix ? grouping.get(prefix) ?? null : null;
}

/**
 * The repo lens — a repo's project badge. A thin re-export of
 * `projectKeyForRepo` so grouping is imported from ONE module; `projects.ts`
 * stays the repo→project engine (its `ProjectTaxonomyV1` group structure is
 * unchanged and still consumed directly by `deriveGitState`).
 */
export function repoBadge(taxonomy: ProjectTaxonomyV1, repoKey: string): string {
  return projectKeyForRepo(taxonomy, repoKey);
}
