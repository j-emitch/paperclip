/**
 * Pure presentation vocabulary for the Skills surface — origin/collection tones +
 * the client-side search filter. No JSX, no SDK runtime. The catalog itself
 * carries the labels (from `deriveSkillsCatalog`), so this module only adds the
 * cockpit's color language + the fold from a query string to a pruned catalog.
 */

import type { SkillEntryV1, SkillOrigin, SkillsCatalogV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";

/** Origin display labels — matched by search so "company"/"installed"/"plugins" find their sections. */
const ORIGIN_MATCH_LABEL: Record<SkillOrigin, string> = {
  company: "company",
  plugins: "installed plugins",
};

/** The origin accent — Company takes the cockpit's signature orange (the star). */
export const ORIGIN_TONE: Record<SkillOrigin, string> = {
  company: tokens.accent,
  plugins: statusColors.proceed,
};

/** One-line origin subtitle, rendered under the section header. */
export const ORIGIN_BLURB: Record<SkillOrigin, string> = {
  company: "Your curated skills — the workflows, rubrics, and design passes that run the shop.",
  plugins: "Installed marketplace & plugin skills available to your agents.",
};

/** A small, stable tone palette so each collection reads a consistent hue. */
const COLLECTION_TONES = [
  statusColors.proceed,
  tokens.accent,
  statusColors.ship,
  statusColors.reviewUnknown,
  statusColors.revise,
  statusColors.nextUp,
];

/** Deterministic tone for a collection key (pinned for the two company collections). */
export function collectionTone(origin: SkillOrigin, collection: string): string {
  if (origin === "company") return collection === "design" ? tokens.accent : statusColors.proceed;
  let h = 0;
  for (let i = 0; i < collection.length; i++) h = (h * 31 + collection.charCodeAt(i)) >>> 0;
  return COLLECTION_TONES[h % COLLECTION_TONES.length]!;
}

/**
 * Flatten a (already filtered) catalog into render-order skill entries: origins ->
 * collections -> skills, exactly as the tree paints them. Powers keyboard up/down
 * nav -- the caller finds the selected entry's index and steps it. Pure; empty in,
 * empty out.
 */
export function flattenVisible(catalog: SkillsCatalogV1): SkillEntryV1[] {
  const out: SkillEntryV1[] = [];
  for (const origin of catalog.origins) {
    for (const collection of origin.collections) {
      for (const skill of collection.skills) out.push(skill);
    }
  }
  return out;
}

/**
 * Next selection index for keyboard up/down nav. `cur` is the current index (or -1
 * when nothing is selected / the selection was filtered out), `len` the visible-list
 * length, `dir` +1 (down) or -1 (up). Clamps at both ends (no wrap); from no
 * selection, down picks the first row and up the last. Returns -1 for an empty list.
 * Pure + total, so the bounds math is unit-tested away from the event handler.
 */
export function stepIndex(cur: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return -1;
  if (cur < 0) return dir === 1 ? 0 : len - 1;
  const next = cur + dir;
  if (next < 0) return 0;
  if (next >= len) return len - 1;
  return next;
}

/** True when a skill matches a lowercased query across name/summary/slug/collection/origin. */
function skillMatches(skill: SkillEntryV1, q: string): boolean {
  return (
    skill.name.toLowerCase().includes(q) ||
    skill.slug.toLowerCase().includes(q) ||
    skill.collection.toLowerCase().includes(q) ||
    ORIGIN_MATCH_LABEL[skill.origin].toLowerCase().includes(q) ||
    (skill.summary?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * Prune the catalog to skills matching `query` (case-insensitive). Empty/blank
 * query returns the catalog unchanged. Origins/collections with no surviving
 * skills are dropped; `total` + per-origin `count` are recomputed so headers stay
 * honest. Pure — the caller re-renders the tree from the result.
 */
export function filterCatalog(catalog: SkillsCatalogV1, query: string): SkillsCatalogV1 {
  const q = query.trim().toLowerCase();
  if (!q) return catalog;
  let total = 0;
  const origins = catalog.origins
    .map((origin) => {
      const collections = origin.collections
        .map((c) => ({ ...c, skills: c.skills.filter((s) => skillMatches(s, q)) }))
        .filter((c) => c.skills.length > 0);
      const count = collections.reduce((sum, c) => sum + c.skills.length, 0);
      total += count;
      return { ...origin, collections, count };
    })
    .filter((o) => o.count > 0);
  return { ...catalog, origins, total };
}
