/**
 * Diagnostics + per-source freshness — primitives shared by ALL three
 * projection contracts (board, artifact index, routine health) and the
 * collection-runs diagnostics row.
 *
 * Defined once here (rather than triplicated across the projection files) so a
 * surface that wants to render "why is this stale / what failed" reads one
 * shape everywhere. zod-validated because these cross the DB/IPC boundary
 * inside every persisted projection.
 */

import { z } from "@paperclipai/plugin-sdk";
import { DIAGNOSTIC_LEVELS, FRESHNESS_LEVELS } from "./vocab.js";

/**
 * A single non-fatal observation surfaced from a derive. Distinct from a
 * `SignalError` (which lives on one signal): a `Diagnostic` is projection-level
 * — "the gh source was rate-limited so the In-review column is last-good".
 */
export const diagnosticSchema = z.object({
  level: z.enum(DIAGNOSTIC_LEVELS),
  /** Stable machine code (e.g. "gh_rate_limited", "repo_unavailable") for grouping + tests. */
  code: z.string().min(1),
  message: z.string(),
  /** Repo this diagnostic pertains to; null = cross-repo / derive-wide. */
  repo: z.string().nullable(),
  /** Source id that raised it; null = projection-level. */
  source: z.string().nullable(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

/**
 * Per-(source, repo) freshness, computed at derive time and embedded in every
 * projection so the UI can render a precise stale badge ("PullRequestSource ·
 * juice-bar · stale · 3 errors") without re-reading anything.
 */
export const sourceFreshnessSchema = z.object({
  /** WorkSignalSource id (e.g. "git-work", "pull-request"). */
  source: z.string().min(1),
  repo: z.string().min(1),
  freshness: z.enum(FRESHNESS_LEVELS),
  /** ISO-8601 of the last successful read for this (source, repo); null = never succeeded. */
  lastOkAt: z.string().nullable(),
  /** Count of non-fatal errors on the most recent collect for this (source, repo). */
  errorCount: z.number().int().nonnegative(),
  /** Human one-liner for the badge tooltip; null = clean. */
  message: z.string().nullable(),
});
export type SourceFreshness = z.infer<typeof sourceFreshnessSchema>;
