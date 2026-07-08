/**
 * `FreshnessBadge` — the doc copy's rung on the COS-8f 5-state ladder, as a
 * viewer-header pill. Pure + SSR-faithful; the connected viewer feeds it the
 * `doc-git-freshness` payload. Non-ok statuses render calmly (a pruned
 * checkout or a git failure is a state to show, not an error to throw).
 */

import type { DocFreshnessV1 } from "../../contracts/index.js";
import type { DocGitFreshnessState } from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";

export const FRESHNESS_LABELS: Record<DocGitFreshnessState, string> = {
  main: "on main",
  uncommitted: "uncommitted edits",
  committed: "committed · not pushed",
  pushed: "pushed · not merged",
  merged: "merged to trunk",
};

export const FRESHNESS_TONES: Record<DocGitFreshnessState, string> = {
  main: tokens.muted,
  uncommitted: tokens.accent,
  committed: statusColors.reviewUnknown,
  pushed: statusColors.proceed,
  merged: statusColors.ship,
};

export function FreshnessBadge({ freshness, loading }: { freshness: DocFreshnessV1 | null; loading: boolean }) {
  if (loading && !freshness) {
    return <Pill label="checking git…" tone={tokens.muted} soft />;
  }
  if (!freshness) return null;
  if (freshness.status === "ok" && freshness.state) {
    return <Pill label={FRESHNESS_LABELS[freshness.state]} tone={FRESHNESS_TONES[freshness.state]} soft />;
  }
  if (freshness.status === "checkout_gone") {
    return <Pill label="checkout gone" tone={statusColors.danger} soft />;
  }
  // not_indexed / git_error — quiet; the viewer body already tells the story.
  return null;
}
