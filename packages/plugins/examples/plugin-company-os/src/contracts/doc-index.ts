/**
 * `DocIndexV1` — the worktree-aware doc-review tree (spec §5.4). Folds two
 * sources into one browsable, deduped **project → type → doc** tree: the new
 * `DocSignal`s (specs/plans/handoffs/backlog across main + every worktree) AND
 * the existing main-checkout `ArtifactSignal`s (specs + review reports +
 * handoffs), normalized to one `DocEntryV1` shape and deduped by `docId`.
 *
 * Metadata only — the body is fetched on demand by the `doc-content` handler,
 * keyed by `docId` → the entry's `checkoutKey` + `relPath` (a contained read
 * against the resolved checkout root; PF-8/PF-9). Per the v4 refinement the read
 * key is `checkoutKey` (an absByKey pseudo-key), NOT an absolute `worktreePath` —
 * the worktree's path survives only as `worktreeName` (basename) provenance.
 *
 * zod-first with vocab-built enums + drift guards, mirroring `artifact-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { sourceFreshnessSchema, diagnosticSchema } from "./diagnostics.js";
import { projectGroupV1Schema, projectTaxonomyV1Schema } from "./projects.js";
import {
  DOC_INDEX_TYPES,
  DOC_PROVENANCES,
  type AssertEqual,
  type DocIndexType,
  type DocProvenance,
  type DocType,
  type Expect,
} from "./vocab.js";

// v2: C1 §2.3 spine fields (owner/lastUpdated/statusVerifiedAt/description) —
// the bump discards v1 cache rows via the version-gated read (no failed parses).
export const DOC_INDEX_SCHEMA_VERSION = 2 as const;

/** `DocsSource` index-time caps (spec §5.4/§12). */
// 8192 = parity with the WF-09 shared parser's head budget (codex order-0 P1:
// a block closing past 4KB indexed in workflow-metadata but field-less here).
export const DOC_FRONTMATTER_SCAN_BYTES = 8192 as const;
export const MAX_DOCS_PER_REPO = 600 as const;

export const docIndexTypeSchema = z.enum(DOC_INDEX_TYPES);
export const docProvenanceSchema = z.enum(DOC_PROVENANCES);

/**
 * One indexed doc. Both signal sources (`DocSignal` + normalized main-checkout
 * `ArtifactSignal`) land in this single shape, deduped by `docId`.
 */
export const docEntryV1Schema = z.object({
  /** Fetch key for `doc-content` = hash(repoKey + checkoutId + relPath). */
  docId: z.string().min(1),
  repoKey: z.string().min(1),
  /** "main" | `worktree:${hash(...)}` — collision-safe. */
  checkoutId: z.string().min(1),
  /** The absByKey key `doc-content` reads against (main repoKey or a worktree pseudo-key; PF-8). */
  checkoutKey: z.string().min(1),
  /** Checkout-root-relative path. */
  relPath: z.string().min(1),
  /** Worktree dir basename for the provenance badge; null = main checkout (no abs path). */
  worktreeName: z.string().nullable(),
  branch: z.string().nullable(),
  provenance: docProvenanceSchema,
  title: z.string().nullable(),
  status: z.string().nullable(),
  /** C1 (§2.3 spine): owner / last-updated / verification-evidence / description. */
  owner: z.string().nullable(),
  lastUpdated: z.string().nullable(),
  statusVerifiedAt: z.string().nullable(),
  description: z.string().nullable(),
  mtime: z.string().min(1),
});
export type DocEntryV1 = z.infer<typeof docEntryV1Schema>;

export const docTypeBucketV1Schema = z.object({
  type: docIndexTypeSchema,
  docs: z.array(docEntryV1Schema),
});
export type DocTypeBucketV1 = z.infer<typeof docTypeBucketV1Schema>;

export const docProjectSectionV1Schema = z.object({
  group: projectGroupV1Schema,
  types: z.array(docTypeBucketV1Schema),
});
export type DocProjectSectionV1 = z.infer<typeof docProjectSectionV1Schema>;

export const docIndexV1Schema = z.object({
  schemaVersion: z.literal(DOC_INDEX_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  /** C4: per-(source,repo) freshness — folded into the SAME v2 bump as the C1 fields. */
  sources: z.array(sourceFreshnessSchema),
  /** Embedded so the UI renders headers without a 2nd fetch. */
  taxonomy: projectTaxonomyV1Schema,
  /** Project → type → doc, in taxonomy order. */
  groups: z.array(docProjectSectionV1Schema),
  diagnostics: z.array(diagnosticSchema),
});
export type DocIndexV1 = z.infer<typeof docIndexV1Schema>;

/**
 * The STABLE doc id = a deterministic composite of `(repoKey, checkoutId,
 * relPath)`. Deliberately NOT a cryptographic hash: the pure `deriveDocIndex`
 * projection (no hasher) must compute the SAME id for a main-checkout
 * `ArtifactSignal` as `DocsSource` does for its `DocSignal`, so the two dedup;
 * and `deriveOrientation` computes a routine report's id for its deep-link. The
 * JSON tuple encoding is unambiguous for ANY input — unlike a delimiter, no
 * character can collide two distinct tuples (codex B P2). The id is opaque to consumers — only
 * equality + index-gated lookup matter (the relPath it embeds is already a field).
 */
export function makeDocId(repoKey: string, checkoutId: string, relPath: string): string {
  return JSON.stringify([repoKey, checkoutId, relPath]);
}

/**
 * Map a main-checkout `ArtifactSignal` path → its `DocIndexType` bucket (§5.4):
 * `reports/handoffs/**`→handoff, `reports/reviews/**` + any other `reports/**`→
 * review, `specs/**` + `docs/superpowers/specs/**`→spec. Plans/backlog never
 * come from `artifactSource` (those are `DocSignal`s).
 */
export function classifyArtifactToDocIndexType(relPath: string): DocIndexType {
  if (/(^|\/)reports\/handoffs\//.test(relPath)) return "handoff";
  if (/(^|\/)reports\//.test(relPath)) return "review";
  return "spec";
}

/** Parse + validate (throws on malformed). Use on cache read. */
export function parseDocIndexV1(input: unknown): DocIndexV1 {
  return docIndexV1Schema.parse(input);
}

export function safeParseDocIndexV1(input: unknown): z.SafeParseReturnType<unknown, DocIndexV1> {
  return docIndexV1Schema.safeParse(input);
}

// Drift guards: the schema enums and the canonical tuples cannot diverge, and
// the index type is exactly DocType ∪ "review".
type _IndexTypeMatches = Expect<AssertEqual<z.infer<typeof docIndexTypeSchema>, DocIndexType>>;
type _IndexTypeIsDocTypePlusReview = Expect<AssertEqual<DocIndexType, DocType | "review">>;
type _ProvenanceMatches = Expect<AssertEqual<z.infer<typeof docProvenanceSchema>, DocProvenance>>;
