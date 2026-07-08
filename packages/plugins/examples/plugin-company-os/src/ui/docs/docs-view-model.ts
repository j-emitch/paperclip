/**
 * Pure presentation vocabulary for the Docs surface — the doc-type bucket labels
 * + tones and the doc-title fallback. The type label comes from the INDEX
 * (`DocEntryV1`/`DocTypeBucketV1.type`), NOT `ReportContentV1.artifactType`
 * (which is null for `plan`/`backlog`), so a plan/backlog doc still shows the
 * right pill. No JSX, no SDK runtime.
 */

import type { DocEntryV1, DocIndexV1 } from "../../contracts/index.js";
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

// ---------------------------------------------------------------------------
// COS-8f T4 — checkout facet + miss-retry (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Facet value: "all", "main", or a worktree basename. */
export const FACET_ALL = "all" as const;

/**
 * The facet options present in this index: All, main (when any main-checkout
 * doc exists), then worktree basenames sorted A→Z. Duplicate basenames appear
 * once — the facet filters by NAME (the ck= disambiguation lives on links,
 * not on this list filter).
 */
export function checkoutFacetsOf(index: DocIndexV1): string[] {
  const names = new Set<string>();
  let hasMain = false;
  for (const group of index.groups) {
    for (const bucket of group.types) {
      for (const doc of bucket.docs) {
        if (doc.worktreeName === null) hasMain = true;
        else names.add(doc.worktreeName);
      }
    }
  }
  const out: string[] = [FACET_ALL];
  if (hasMain) out.push("main");
  out.push(...[...names].sort((a, b) => a.localeCompare(b)));
  return out;
}

/** Filter the index to one checkout facet (structure-preserving; "all" = identity). */
export function filterDocIndexByCheckout(index: DocIndexV1, facet: string): DocIndexV1 {
  if (facet === FACET_ALL) return index;
  const match = (doc: DocEntryV1) => (facet === "main" ? doc.worktreeName === null : doc.worktreeName === facet);
  return {
    ...index,
    groups: index.groups.map((group) => ({
      ...group,
      types: group.types.map((bucket) => ({ ...bucket, docs: bucket.docs.filter(match) })),
    })),
  };
}

/**
 * Miss-retry state machine (§4.1 row 3): a missed URL fires ONE scoped
 * refresh, auto-retries at most `MISS_MAX_ATTEMPTS` total dispatches, and
 * COALESCES — `beginMissRefresh` while a dispatch is in flight (or after
 * exhaustion) never produces a second dispatch, no matter how often the
 * button is clicked. Pure so the coalescing is unit-testable without a DOM.
 */
export const MISS_MAX_ATTEMPTS = 3; // 1 initial + ≤2 auto-retries
export const MISS_RETRY_BACKOFF_MS = [1_200, 2_400] as const;

export interface MissRetryState {
  attempts: number;
  inFlight: boolean;
  exhausted: boolean;
}

export const MISS_RETRY_INITIAL: MissRetryState = { attempts: 0, inFlight: false, exhausted: false };

export function beginMissRefresh(state: MissRetryState): { next: MissRetryState; dispatch: boolean } {
  if (state.inFlight || state.exhausted) return { next: state, dispatch: false };
  return { next: { ...state, inFlight: true, attempts: state.attempts + 1 }, dispatch: true };
}

export function completeMissRefresh(state: MissRetryState, stillMissing: boolean): MissRetryState {
  const exhausted = stillMissing && state.attempts >= MISS_MAX_ATTEMPTS;
  return { attempts: state.attempts, inFlight: false, exhausted };
}
