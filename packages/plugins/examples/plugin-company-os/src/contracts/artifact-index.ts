/**
 * `ArtifactIndexV1` — the shared artifact projection (spec §7), persisted from
 * `ArtifactSignal`s. Both the Reports tab (filter by type/system/prefix/date)
 * and the Agents cockpit (join routine contracts against artifact mtime) read it,
 * so it is one index, not two. COS-1 teaching nuggets + COS-2 knowledge docs
 * are already first-class `artifact_type`s (see `vocab.ts`), so neither phase
 * needs a schema bump.
 *
 * zod-first with vocab-built enums + a drift guard, mirroring `board-state.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import { ARTIFACT_TYPES, type ArtifactType, type AssertEqual, type Expect } from "./vocab.js";

export const ARTIFACT_INDEX_SCHEMA_VERSION = 1 as const;

export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);

/** One indexed artifact (mirrors a `cos_artifact_index` row). */
export const artifactEntrySchema = z.object({
  repo: z.string().min(1),
  /** Workspace-relative path (never absolute — containment-checked at read). */
  relPath: z.string().min(1),
  artifactType: artifactTypeSchema,
  /** L1 system from frontmatter/path; null when unknown. */
  system: z.string().nullable(),
  /** Prefix from frontmatter/filename; null when unknown. */
  prefix: z.string().nullable(),
  /** Lifecycle status from frontmatter; null when absent. */
  status: z.string().nullable(),
  sha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  /** ISO-8601 mtime. */
  mtime: z.string().min(1),
  /** Human title from frontmatter/first-heading; null when absent. */
  title: z.string().nullable(),
});
export type ArtifactEntry = z.infer<typeof artifactEntrySchema>;

export const artifactIndexV1Schema = z.object({
  schemaVersion: z.literal(ARTIFACT_INDEX_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  entries: z.array(artifactEntrySchema),
  /**
   * Per-type counts for the Reports filter chips (e.g. { spec: 42, cannons: 34 }).
   * Keys are constrained to the artifact-type vocabulary (a typo'd key is
   * rejected); the map is sparse — zero-count types may be omitted.
   */
  countsByType: z.record(artifactTypeSchema, z.number().int().nonnegative()),
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(diagnosticSchema),
});
export type ArtifactIndexV1 = z.infer<typeof artifactIndexV1Schema>;

/** Parse + validate (throws on malformed). Use on cache read. */
export function parseArtifactIndexV1(input: unknown): ArtifactIndexV1 {
  return artifactIndexV1Schema.parse(input);
}

export function safeParseArtifactIndexV1(
  input: unknown,
): z.SafeParseReturnType<unknown, ArtifactIndexV1> {
  return artifactIndexV1Schema.safeParse(input);
}

// Drift guard: the schema enum and the canonical tuple cannot diverge.
type _ArtifactTypeMatches = Expect<AssertEqual<z.infer<typeof artifactTypeSchema>, ArtifactType>>;
