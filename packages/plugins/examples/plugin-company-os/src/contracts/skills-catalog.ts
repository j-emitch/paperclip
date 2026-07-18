/**
 * `SkillsCatalogV1` — the auto-updating catalog of Claude/Codex skills the Skills
 * tab reads (COS-1h). Folds every `SkillSignal` into a browsable **origin →
 * collection → skill** tree.
 *
 * Two origins, deliberately ordered so the "ours" set is the star:
 *   - `company` — the curated skills that live IN the workspace (`config/skills/**`:
 *     house-authored + the 21 WF-12-materialized design skills, all real in-repo dirs;
 *     the design collection is classified via `config/skills-collections.json`). The
 *     primary surface.
 *   - `plugins` — installed marketplace/plugin skills read from optional, contained
 *     `skillRoots` (e.g. `~/.claude/plugins/cache`). A separate, secondary
 *     sub-section; calmly empty (show-0) when no plugin roots are configured/present.
 *
 * Metadata only at index time: the frontmatter head (name + description) is read,
 * never the body — the body is fetched on demand by the `skill-content` handler,
 * keyed by `skillId` → the entry's `checkoutKey` + `relPath` (a contained read
 * against the resolved root; mirrors `doc-content`). zod-first with a self-
 * contained origin enum + drift guards, mirroring `doc-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema } from "./diagnostics.js";

export const SKILLS_CATALOG_SCHEMA_VERSION = 1 as const;

/** `SkillsSource` index-time caps (mirrors DocsSource's head-scan + per-root cap). */
export const SKILL_FRONTMATTER_SCAN_BYTES = 4096 as const;
export const MAX_SKILLS_PER_ROOT = 1000 as const;

/**
 * The two skill origins, ordered `company` first so the UI renders the "ours"
 * set as the primary surface and installed plugins as a secondary sub-section.
 */
export const SKILL_ORIGINS = ["company", "plugins"] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];
export const skillOriginSchema = z.enum(SKILL_ORIGINS);

/**
 * An extra contained read-root the `SkillsSource` scans, OUTSIDE the `company`
 * repo's own `config/skills`. Post-WF-12 this is only installed-plugin caches
 * (`~/.claude/plugins/cache`, `~/.codex/plugins/cache`) — origin "plugins",
 * `collection: null` (derived per-skill from the path). The company design skills
 * are NOT an extra root: WF-12 git-tracked them into `config/skills`, so they are
 * read in-repo (origin "company") and tagged `collection: "design"` via
 * `config/skills-collections.json`.
 * `key` is the read-KEY (namespaced so it can't collide with a repo key).
 */
export interface SkillRootRef {
  readonly key: string;
  readonly origin: SkillOrigin;
  /** Fixed collection for every skill under this root; null = derive per-skill. */
  readonly collection: string | null;
}

/**
 * One indexed skill. Every `SkillSignal` normalizes to this single shape,
 * deduped by `skillId`. `checkoutKey` + `relPath` are the contained read key the
 * `skill-content` handler resolves the full SKILL.md body against (never an
 * absolute host path — `checkoutKey` is a read-key into the resolved root map).
 */
export const skillEntryV1Schema = z.object({
  /** Fetch key for `skill-content` = makeSkillId(checkoutKey, relPath). Opaque to the UI. */
  skillId: z.string().min(1),
  origin: skillOriginSchema,
  /**
   * Sub-grouping within an origin: for `company`, "design" or "core" (both from
   * `config/skills`, classified via `config/skills-collections.json`); for
   * `plugins`, the plugin/marketplace slug.
   */
  collection: z.string().min(1),
  /** The read-key the body is fetched against (company repo key or a plugin-root key). */
  checkoutKey: z.string().min(1),
  /** Root-relative path to the SKILL.md. */
  relPath: z.string().min(1),
  /** The skill's slug (its directory basename) — stable id within a collection. */
  slug: z.string().min(1),
  /** Frontmatter `name`, else the slug. */
  name: z.string().min(1),
  /** Frontmatter `description` — the one-line summary shown in the list. Null when absent. */
  summary: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  mtime: z.string().min(1),
});
export type SkillEntryV1 = z.infer<typeof skillEntryV1Schema>;

export const skillCollectionV1Schema = z.object({
  /** The collection key (e.g. "design", "core", or a plugin slug). */
  collection: z.string().min(1),
  /** Human label for the collection header. */
  label: z.string().min(1),
  skills: z.array(skillEntryV1Schema),
});
export type SkillCollectionV1 = z.infer<typeof skillCollectionV1Schema>;

export const skillOriginSectionV1Schema = z.object({
  origin: skillOriginSchema,
  /** Human label for the origin header (e.g. "Company", "Installed plugins"). */
  label: z.string().min(1),
  /** Collections in stable order (alpha, "core"/"design" pinned for company). */
  collections: z.array(skillCollectionV1Schema),
  /** Total skills across all collections in this origin (show-0 friendly). */
  count: z.number().int().nonnegative(),
});
export type SkillOriginSectionV1 = z.infer<typeof skillOriginSectionV1Schema>;

export const skillsCatalogV1Schema = z.object({
  schemaVersion: z.literal(SKILLS_CATALOG_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  /** Origin sections in `SKILL_ORIGINS` order (company first). */
  origins: z.array(skillOriginSectionV1Schema),
  /** Grand total across every origin. */
  total: z.number().int().nonnegative(),
  diagnostics: z.array(diagnosticSchema),
});
export type SkillsCatalogV1 = z.infer<typeof skillsCatalogV1Schema>;

/**
 * The STABLE skill id = a deterministic composite of `(checkoutKey, relPath)`.
 * Like `makeDocId`, deliberately NOT a cryptographic hash — the pure
 * `deriveSkillsCatalog` projection (no hasher) must compute the SAME id the
 * source does, and the `skill-content` handler re-derives it for the lookup. The
 * JSON tuple encoding is unambiguous for ANY input (no delimiter can collide two
 * distinct tuples). The id is opaque to consumers — only equality + index-gated
 * lookup matter (the relPath it embeds is already a field).
 */
export function makeSkillId(checkoutKey: string, relPath: string): string {
  return JSON.stringify(["skill", checkoutKey, relPath]);
}

/** Parse + validate (throws on malformed). Use on cache read + before worker return. */
export function parseSkillsCatalogV1(input: unknown): SkillsCatalogV1 {
  return skillsCatalogV1Schema.parse(input);
}

export function safeParseSkillsCatalogV1(input: unknown): z.SafeParseReturnType<unknown, SkillsCatalogV1> {
  return skillsCatalogV1Schema.safeParse(input);
}

// Drift guard: the schema enum and the canonical tuple cannot diverge.
type AssertEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type _OriginMatches = Expect<AssertEqual<z.infer<typeof skillOriginSchema>, SkillOrigin>>;
