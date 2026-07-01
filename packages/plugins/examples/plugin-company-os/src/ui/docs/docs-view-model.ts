/**
 * Pure presentation vocabulary for the Docs surface — the doc-type bucket labels
 * + tones and the doc-title fallback. The type label comes from the INDEX
 * (`DocEntryV1`/`DocTypeBucketV1.type`), NOT `ReportContentV1.artifactType`
 * (which is null for `plan`/`backlog`), so a plan/backlog doc still shows the
 * right pill. No JSX, no SDK runtime.
 */

import type { DocEntryV1 } from "../../contracts/index.js";
import type { DocIndexType } from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";
import { baseName } from "../shared/document-text.js";

/** Bucket headers (plural) in the order they render within a project. */
export const DOC_TYPE_ORDER: readonly DocIndexType[] = ["spec", "plan", "handoff", "backlog", "review"];

export const DOC_TYPE_LABELS: Record<DocIndexType, string> = {
  spec: "Specs",
  plan: "Plans",
  handoff: "Handoffs",
  backlog: "Backlog",
  review: "Reviews",
};

/** Singular label for the viewer type pill. */
export const DOC_TYPE_LABEL_SINGULAR: Record<DocIndexType, string> = {
  spec: "Spec",
  plan: "Plan",
  handoff: "Handoff",
  backlog: "Backlog",
  review: "Review",
};

export const DOC_TYPE_TONES: Record<DocIndexType, string> = {
  spec: statusColors.proceed,
  plan: statusColors.reviewUnknown,
  handoff: tokens.accent,
  backlog: tokens.muted,
  review: statusColors.ship,
};

/** A doc's display title — its frontmatter title, else the file basename. */
export function docTitle(entry: DocEntryV1): string {
  return entry.title ?? baseName(entry.relPath);
}
