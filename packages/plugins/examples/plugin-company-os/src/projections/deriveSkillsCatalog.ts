/**
 * `deriveSkillsCatalog` — pure fold of `SkillSignal`s into the **origin →
 * collection → skill** tree the Skills tab reads (COS-1h). Deduped by the shared
 * `skillId` (= makeSkillId(checkoutKey, relPath)); the first signal for an id wins.
 *
 * Both origin sections are ALWAYS emitted (company first, then plugins) so the UI
 * renders a stable, honest 0-state (show-0-counts) rather than hiding an empty
 * "Installed plugins" section. Collections sort with the company set pinned
 * (Workflow & Infra, then Design & UX) and plugin collections alphabetical; skills
 * sort by name within a collection. No taxonomy lens — skills group by origin, not
 * by project.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import { isSkillSignal } from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import {
  SKILLS_CATALOG_SCHEMA_VERSION,
  SKILL_ORIGINS,
  type SkillCollectionV1,
  type SkillEntryV1,
  type SkillOrigin,
  type SkillOriginSectionV1,
  type SkillsCatalogV1,
} from "../contracts/skills-catalog.js";
import { isoFrom } from "./_shared.js";

const ORIGIN_LABELS: Record<SkillOrigin, string> = {
  company: "Company",
  plugins: "Installed plugins",
};

/** Company collection headers + their pinned render order (design/core are the only two). */
const COMPANY_COLLECTION_LABELS: Record<string, string> = {
  core: "Workflow & Infra",
  design: "Design & UX",
};
const COMPANY_COLLECTION_ORDER = ["core", "design"];

export function deriveSkillsCatalog(bundle: SignalBundle, nowMs: number): SkillsCatalogV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const diagnostics: Diagnostic[] = [];

  // Surface a SkillsSource truncation (MAX_SKILLS_PER_ROOT cap) as a diagnostic —
  // it rides in RepoFreshness.errors as a NON-degraded "truncated" error, so make
  // it visible here (mirrors deriveDocIndex).
  for (const batch of bundle.batches) {
    if (batch.source !== "skills") continue;
    for (const rf of batch.repoFreshness) {
      for (const e of rf.errors) {
        if (e.code === "truncated") {
          diagnostics.push({ level: "warn", code: "skill_index_truncated", message: e.message, repo: rf.repo, source: batch.source });
        }
      }
    }
  }

  // Dedup by skillId; first signal wins.
  const byId = new Map<string, SkillEntryV1>();
  for (const s of signals.filter(isSkillSignal)) {
    if (byId.has(s.skillId)) continue;
    byId.set(s.skillId, {
      skillId: s.skillId,
      origin: s.origin,
      collection: s.collection,
      checkoutKey: s.checkoutKey,
      relPath: s.relPath,
      slug: s.slug,
      name: s.name,
      summary: s.summary,
      sizeBytes: s.sizeBytes,
      mtime: s.mtime,
    });
  }

  // Bucket by origin → collection.
  const byOrigin = new Map<SkillOrigin, Map<string, SkillEntryV1[]>>();
  for (const entry of byId.values()) {
    const collections = byOrigin.get(entry.origin) ?? new Map<string, SkillEntryV1[]>();
    const arr = collections.get(entry.collection) ?? [];
    arr.push(entry);
    collections.set(entry.collection, arr);
    byOrigin.set(entry.origin, collections);
  }

  // Emit both origin sections in canonical order (company first), show-0 friendly.
  let total = 0;
  const origins: SkillOriginSectionV1[] = SKILL_ORIGINS.map((origin): SkillOriginSectionV1 => {
    const collectionsMap = byOrigin.get(origin) ?? new Map<string, SkillEntryV1[]>();
    const collections: SkillCollectionV1[] = [...collectionsMap.entries()]
      .map(([collection, skills]): SkillCollectionV1 => ({
        collection,
        label: collectionLabel(origin, collection),
        skills: skills.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)),
      }))
      .sort((a, b) => collectionRank(origin, a.collection) - collectionRank(origin, b.collection) || a.label.localeCompare(b.label));
    const count = collections.reduce((sum, c) => sum + c.skills.length, 0);
    total += count;
    return { origin, label: ORIGIN_LABELS[origin], collections, count };
  });

  return {
    schemaVersion: SKILLS_CATALOG_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    origins,
    total,
    diagnostics,
  };
}

/** Human label for a collection header. */
function collectionLabel(origin: SkillOrigin, collection: string): string {
  if (origin === "company") return COMPANY_COLLECTION_LABELS[collection] ?? titleCase(collection);
  return titleCase(collection);
}

/** Sort rank: company collections pinned in `COMPANY_COLLECTION_ORDER`; plugin collections alpha (0). */
function collectionRank(origin: SkillOrigin, collection: string): number {
  if (origin !== "company") return 0;
  const i = COMPANY_COLLECTION_ORDER.indexOf(collection);
  return i === -1 ? COMPANY_COLLECTION_ORDER.length : i;
}

/** "superpowers-marketplace" → "Superpowers Marketplace"; "core" → "Core". */
function titleCase(slug: string): string {
  return slug
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || slug;
}
