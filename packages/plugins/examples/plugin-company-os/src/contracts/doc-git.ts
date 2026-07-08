/**
 * `DocFreshnessV1` + `DocDiffV1` — the COS-8f git-truth reads for a doc COPY
 * (spec §5.1): where the selected copy sits on the 5-state freshness ladder,
 * and its diff vs trunk. Both are worker-side READ handlers keyed by `docId`,
 * sharing `doc-content`'s defense ladder: index gate → checkout resolvable →
 * bounded git calls against the resolved checkout root. A worktree pruned
 * between index fetch and git call is a TYPED `checkout_gone` result (§4.1
 * row 4) — never a throw, never a raw read.
 *
 * zod-first, mirroring `report-content.ts`.
 */

import { z } from "@paperclipai/plugin-sdk";
import { DOC_GIT_FRESHNESS_STATES, DOC_GIT_READ_STATUSES, type AssertEqual, type DocGitFreshnessState, type DocGitReadStatus, type Expect } from "./vocab.js";

export const DOC_GIT_SCHEMA_VERSION = 1 as const;

/** Diff payload cap (plan T3): 256KB, then truncate + flag. */
export const DOC_DIFF_MAX_BYTES = 262_144 as const;

export const docGitFreshnessStateSchema = z.enum(DOC_GIT_FRESHNESS_STATES);
export const docGitReadStatusSchema = z.enum(DOC_GIT_READ_STATUSES);

/**
 * The 5-state ladder, for one doc copy:
 *   `main`        — the main-checkout copy (trunk-side by definition).
 *   `uncommitted` — the worktree copy has uncommitted (or untracked) changes.
 *   `committed`   — committed on the worktree branch, not on its upstream yet.
 *   `pushed`      — on the upstream, but not folded into trunk.
 *   `merged`      — its content has reached trunk (no diff vs merge-base).
 */
export const docFreshnessV1Schema = z.object({
  schemaVersion: z.literal(DOC_GIT_SCHEMA_VERSION),
  status: docGitReadStatusSchema,
  docId: z.string().min(1),
  repoKey: z.string().min(1),
  relPath: z.string().min(1),
  /** Worktree basename, or "main". */
  checkout: z.string().min(1),
  branch: z.string().nullable(),
  /** Non-null exactly when `status === "ok"`. */
  state: docGitFreshnessStateSchema.nullable(),
  /** Human context for non-ok statuses (and trunk-detection notes). */
  message: z.string().nullable(),
});
export type DocFreshnessV1 = z.infer<typeof docFreshnessV1Schema>;

export const docDiffV1Schema = z.object({
  schemaVersion: z.literal(DOC_GIT_SCHEMA_VERSION),
  status: docGitReadStatusSchema,
  docId: z.string().min(1),
  repoKey: z.string().min(1),
  relPath: z.string().min(1),
  checkout: z.string().min(1),
  /**
   * `diff` = unified diff vs trunk merge-base (working-tree-inclusive);
   * `untracked_new` = the whole file is new (never committed);
   * `unchanged` = byte-identical to trunk. Non-null exactly when ok.
   */
  kind: z.enum(["diff", "untracked_new", "unchanged"]).nullable(),
  /** `git diff --stat` summary text (null when unchanged/non-ok). */
  stat: z.string().nullable(),
  /** Unified diff text, capped at `DOC_DIFF_MAX_BYTES`. */
  diff: z.string().nullable(),
  truncated: z.boolean(),
  message: z.string().nullable(),
});
export type DocDiffV1 = z.infer<typeof docDiffV1Schema>;

export function parseDocFreshnessV1(input: unknown): DocFreshnessV1 {
  return docFreshnessV1Schema.parse(input);
}

export function parseDocDiffV1(input: unknown): DocDiffV1 {
  return docDiffV1Schema.parse(input);
}

// Drift guards: schema enums and vocab tuples cannot diverge.
type _StateMatches = Expect<AssertEqual<z.infer<typeof docGitFreshnessStateSchema>, DocGitFreshnessState>>;
type _StatusMatches = Expect<AssertEqual<z.infer<typeof docGitReadStatusSchema>, DocGitReadStatus>>;
