/**
 * COS-8d head-review affordances, shared by the branch rows AND the worktree
 * cards so "reviewed at HEAD" reads identically on both surfaces.
 *
 * `HeadReviewChip` is the compact cue — the NEWEST joined report as
 * "<kind> · <verdict>" (text, never color-only). Rendered only when a report
 * joined: most branches have none, and reports are gitignored + machine-local
 * (INFRA-13), so a chip-per-branch "no review" would be noise, not honesty.
 * `HeadReviewsDetail` is the expanded line: every joined report with its lane
 * provenance (reportKind; ENGINE mix once the COS-11 ledger supplies it),
 * p0/p1/p2, and age — and an EXPLICIT muted "no review report on disk for this
 * head" when none joined (the absence-is-normal idiom, spec §8.13).
 * Pure + SSR-faithful; no SDK runtime.
 */

import type { HeadReviewV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { relativeTime } from "../shared/time.js";
import { REVIEW_VERDICT_LABELS, REVIEW_VERDICT_TONES } from "../shared/git-labels.js";

/** Compact header cue: the newest joined report; nothing when none joined. */
export function HeadReviewChip({ reviews }: { reviews: readonly HeadReviewV1[] }) {
  const newest = reviews.length > 0 ? reviews[0] : null;
  if (newest === null) return null;
  return (
    <Pill
      label={`${newest.reportKind} · ${REVIEW_VERDICT_LABELS[newest.verdict]}`}
      tone={REVIEW_VERDICT_TONES[newest.verdict]}
      soft
      withDot
      title="review report joined to the CURRENT head (the pre-push sha rule); a newer commit un-joins it"
    />
  );
}

function counts(r: HeadReviewV1): string | null {
  if (r.p0 === null && r.p1 === null && r.p2 === null) return null;
  return [r.p0 !== null ? `P0 ${r.p0}` : null, r.p1 !== null ? `P1 ${r.p1}` : null, r.p2 !== null ? `P2 ${r.p2}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Expanded detail: one line per joined report, or the explicit absence line. */
export function HeadReviewsDetail({ reviews, now }: { reviews: readonly HeadReviewV1[]; now: number }) {
  if (reviews.length === 0) {
    return (
      <span style={{ fontSize: 11.5, color: tokens.muted }} title="reports are machine-local and retention-pruned (INFRA-13) — absence is normal, not an error">
        no review report on disk for this head
      </span>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {reviews.map((r) => {
        const age = relativeTime(r.generatedAt, now);
        const c = counts(r);
        return (
          <div key={r.reportKind} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
            <Pill label={r.reportKind} tone={tokens.muted} title="which report store reviewed this head" />
            <Pill label={REVIEW_VERDICT_LABELS[r.verdict]} tone={REVIEW_VERDICT_TONES[r.verdict]} soft withDot />
            {c ? (
              <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{c}</span>
            ) : null}
            {r.engines.length > 0 ? (
              <span style={{ fontSize: 11, color: tokens.muted }} title="review lanes recorded by the dispatch ledger">
                lanes: {r.engines.join(", ")}
              </span>
            ) : null}
            <span style={{ flex: 1 }} />
            {age ? (
              <span style={{ fontSize: 11, color: tokens.muted }} title={r.generatedAt}>
                {age}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
