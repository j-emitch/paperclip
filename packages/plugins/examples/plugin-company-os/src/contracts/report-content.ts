/**
 * `ReportContentV1` — the docs-viewer payload (spec §7). Unlike the three cached
 * projections, this is read LIVE per request (a single workspace file), so it is
 * not persisted; it is still a validated contract so the worker handler and the
 * UI agree on exactly one shape and every refusal is typed.
 *
 * Safety invariant (spec §7 + §11 C1): the browser only ever receives a
 * workspace-RELATIVE path + one of the `ReportContentStatus` outcomes. An
 * absolute host path, a raw read error, or file bytes outside the vetted artifact
 * index never cross the bridge. `content` is non-null only when `status === "ok"`.
 *
 * zod-first with vocab-built enums + a drift guard, mirroring `artifact-index.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { artifactTypeSchema } from "./artifact-index.js";
import {
  REPORT_CONTENT_STATUSES,
  REPORT_RENDER_MODES,
  type AssertEqual,
  type Expect,
  type ReportContentStatus,
  type ReportRenderMode,
} from "./vocab.js";

export const REPORT_CONTENT_SCHEMA_VERSION = 1 as const;

export const reportContentStatusSchema = z.enum(REPORT_CONTENT_STATUSES);
export const reportRenderModeSchema = z.enum(REPORT_RENDER_MODES);

export const reportContentV1Schema = z.object({
  schemaVersion: z.literal(REPORT_CONTENT_SCHEMA_VERSION),
  /** The repo key the file lives in (never an absolute path). */
  repo: z.string().min(1),
  /** Workspace-relative path (containment-checked; never absolute). */
  relPath: z.string().min(1),
  status: reportContentStatusSchema,
  renderMode: reportRenderModeSchema,
  /** UTF-8 file content — non-null ONLY when `status === "ok"`. */
  content: z.string().nullable(),
  /** Size from the index/stat (bytes); 0 when unknown. */
  sizeBytes: z.number().int().nonnegative(),
  /** ISO-8601 mtime from the index/stat; null when unknown. */
  mtime: z.string().nullable(),
  /** Human title from the index entry; null when absent. */
  title: z.string().nullable(),
  /** Lifecycle status from the index entry's frontmatter (e.g. "shipped"); null when absent. */
  docStatus: z.string().nullable(),
  /** The artifact type from the index entry; null when not indexed. */
  artifactType: artifactTypeSchema.nullable(),
  /** Human one-liner explaining a non-`ok` status (sanitized — relative path only). */
  message: z.string().nullable(),
});
export type ReportContentV1 = z.infer<typeof reportContentV1Schema>;

/** Parse + validate (throws on malformed). Use before returning from the worker handler. */
export function parseReportContentV1(input: unknown): ReportContentV1 {
  return reportContentV1Schema.parse(input);
}

export function safeParseReportContentV1(
  input: unknown,
): z.SafeParseReturnType<unknown, ReportContentV1> {
  return reportContentV1Schema.safeParse(input);
}

// Drift guards: the schema enums and the canonical tuples cannot diverge.
type _StatusMatches = Expect<AssertEqual<z.infer<typeof reportContentStatusSchema>, ReportContentStatus>>;
type _RenderMatches = Expect<AssertEqual<z.infer<typeof reportRenderModeSchema>, ReportRenderMode>>;
