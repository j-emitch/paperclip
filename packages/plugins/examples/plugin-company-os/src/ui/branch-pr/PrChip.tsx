/**
 * `PrChip` / `PrDetailRow` — the open-PR affordances for the Branch·PR Health tab
 * (COS-5e). `PrChip` is the compact header cue (PR number + draft/open + a review
 * verdict pill), reused on the branch header AND the attention band. `PrDetailRow`
 * is the expanded block: the PR as a real `<a>` (keyboard + middle-click native,
 * mirroring the board chip), its review verdict with p0/p1/p2 counts, draft state,
 * last-updated age, resolved tickets, and a "local N ahead of the PR head" note when
 * the branch tip has moved past the pushed PR head.
 *
 * Review state is never color-only (Joe's a11y rule): every verdict carries its text
 * label, and an ABSENT review reads as a muted "no review" — never a false green.
 * Pure + SSR-faithful; no SDK runtime.
 */

import type { BranchPrV1 } from "../../contracts/index.js";
import type { PrCiState, PrMergeableState, PrReviewDecision } from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { ExternalLinkIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { REVIEW_VERDICT_LABELS, REVIEW_VERDICT_TONES } from "../shared/git-labels.js";

/** The verdict pill (or a muted "no review" when the PR has no joined report). */
function ReviewPill({ pr, soft = true }: { pr: BranchPrV1; soft?: boolean }) {
  if (pr.review === null) {
    return <Pill label="no review" tone={tokens.muted} title="no cannons/review report is joined to this PR head" />;
  }
  const { verdict, current } = pr.review;
  const label = current ? REVIEW_VERDICT_LABELS[verdict] : `${REVIEW_VERDICT_LABELS[verdict]} · stale`;
  return (
    <Pill
      label={label}
      tone={REVIEW_VERDICT_TONES[verdict]}
      soft={soft}
      withDot
      title={current ? "review of the current PR head" : "an older report — a newer PR head has no report yet"}
    />
  );
}

/**
 * COS-8a action chips — CI, mergeability, review decision. UI-local label/tone
 * maps (the import boundary forbids VALUE imports from contracts; the Record
 * keys keep them compile-drift-guarded against the vocab). `unknown` renders
 * NOTHING on either surface: "we couldn't look" earns a quiet absence, while
 * `none` ("no checks configured") earns an honest muted chip on the detail row.
 */
const CI_LABELS: Record<PrCiState, string | null> = {
  pass: "CI pass",
  fail: "CI failing",
  pending: "CI running",
  none: "no checks",
  unknown: null,
};
const CI_TONES: Record<PrCiState, string> = {
  pass: statusColors.ship,
  fail: statusColors.danger,
  pending: statusColors.cached,
  none: tokens.muted,
  unknown: tokens.muted,
};
/** Compact surfaces show CI only when it DEMANDS something (fail/pending). */
const CI_COMPACT: Record<PrCiState, boolean> = { pass: false, fail: true, pending: true, none: false, unknown: false };

const REVIEW_DECISION_LABELS: Record<PrReviewDecision, string | null> = {
  approved: "approved",
  changes_requested: "changes requested",
  review_required: "awaiting review",
  unknown: null,
};
const REVIEW_DECISION_TONES: Record<PrReviewDecision, string> = {
  approved: statusColors.ship,
  changes_requested: statusColors.stale,
  review_required: tokens.muted,
  unknown: tokens.muted,
};
/** Compact surfaces show the decision only for changes-requested (the action). */
const DECISION_COMPACT: Record<PrReviewDecision, boolean> = {
  approved: false,
  changes_requested: true,
  review_required: false,
  unknown: false,
};

function ActionChips({ pr, compact }: { pr: BranchPrV1; compact: boolean }) {
  const ciLabel = CI_LABELS[pr.ciState];
  const showCi = ciLabel !== null && (!compact || CI_COMPACT[pr.ciState]);
  const showBlocked: boolean = pr.mergeableState === ("conflicting" satisfies PrMergeableState);
  const decisionLabel = REVIEW_DECISION_LABELS[pr.reviewDecision];
  const showDecision = decisionLabel !== null && !pr.isDraft && (!compact || DECISION_COMPACT[pr.reviewDecision]);
  if (!showCi && !showBlocked && !showDecision) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {showCi ? <Pill label={ciLabel!} tone={CI_TONES[pr.ciState]} soft={pr.ciState !== "fail"} withDot={pr.ciState === "fail"} title="CI status of the PR head (statusCheckRollup)" /> : null}
      {showBlocked ? <Pill label="merge blocked" tone={statusColors.danger} withDot title="GitHub reports this PR as CONFLICTING with its base" /> : null}
      {showDecision ? (
        <Pill
          label={decisionLabel!}
          tone={REVIEW_DECISION_TONES[pr.reviewDecision]}
          soft={pr.reviewDecision !== "changes_requested"}
          title={`GitHub review decision: ${decisionLabel!}`}
        />
      ) : null}
    </span>
  );
}

/** The draft/open lifecycle marker (text, never color-only). */
function StateMark({ isDraft }: { isDraft: boolean }) {
  return isDraft ? (
    <Pill label="draft" tone={tokens.muted} title="draft PR" />
  ) : (
    <Pill label="open" tone={statusColors.proceed} title="open PR" />
  );
}

/** Compact PR cue for a branch header / the attention band. */
export function PrChip({ pr }: { pr: BranchPrV1 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span style={{ fontFamily: tokens.mono, fontSize: 11, fontWeight: 600, color: tokens.fg }}>#{pr.prNumber}</span>
      <StateMark isDraft={pr.isDraft} />
      <ReviewPill pr={pr} />
      <ActionChips pr={pr} compact />
    </span>
  );
}

/** p0·p1·p2 counts, shown only when the review records them; p0>0 reads danger. */
function IssueCounts({ pr }: { pr: BranchPrV1 }) {
  if (pr.review === null) return null;
  const { p0, p1, p2 } = pr.review;
  if (p0 === null && p1 === null && p2 === null) return null;
  const cell = (label: string, n: number | null, danger: boolean) =>
    n === null ? null : (
      <span
        key={label}
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: danger && n > 0 ? statusColors.danger : tokens.muted,
          fontWeight: danger && n > 0 ? 650 : 500,
        }}
        title={`${n} ${label} finding${n === 1 ? "" : "s"}`}
      >
        {label} {n}
      </span>
    );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {cell("P0", p0, true)}
      {cell("P1", p1, false)}
      {cell("P2", p2, false)}
    </span>
  );
}

/**
 * Full PR row for an expanded branch / the orphan-PR list. `branchHeadSha` is the
 * LOCAL branch tip — when it differs from the PR head oid the local branch has
 * commits the pushed PR head doesn't (needs a push), surfaced as an honest note.
 */
export function PrDetailRow({
  pr,
  now,
  branchHeadSha = null,
  showHeadRef = false,
}: {
  pr: BranchPrV1;
  now: number;
  branchHeadSha?: string | null;
  showHeadRef?: boolean;
}) {
  const updated = relativeTime(pr.updatedAt, now);
  // The local tip differs from the pushed PR head — direction is NOT proven (local could be
  // ahead OR behind OR diverged), so the copy stays neutral (codex/Opus P2): fetch-or-push.
  const localDiffersFromPrHead = branchHeadSha !== null && pr.headSha !== null && branchHeadSha !== pr.headSha;
  const title = pr.title ?? pr.headRef ?? `PR #${pr.prNumber}`;
  const isLink = pr.url !== null && pr.url !== "";

  const heading = (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
      <span style={{ fontFamily: tokens.mono, fontSize: 11.5, fontWeight: 700, color: tokens.accent, flex: "0 0 auto" }}>
        #{pr.prNumber}
      </span>
      <span
        style={{ fontSize: 12.5, color: tokens.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {title}
      </span>
      {isLink ? (
        <span aria-hidden="true" style={{ display: "inline-flex", color: tokens.muted, flex: "0 0 auto" }}>
          <ExternalLinkIcon size={11} />
        </span>
      ) : null}
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${pr.review ? REVIEW_VERDICT_TONES[pr.review.verdict] : tokens.border}`,
        borderRadius: tokens.radiusSm,
        background: tokens.card,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        {isLink ? (
          <a
            href={pr.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="cos-fx-row"
            style={{ textDecoration: "none", minWidth: 0, borderRadius: tokens.radiusSm }}
            title={`Open PR #${pr.prNumber} on GitHub`}
          >
            {heading}
          </a>
        ) : (
          heading
        )}
        <span style={{ flex: 1 }} />
        <StateMark isDraft={pr.isDraft} />
        <ReviewPill pr={pr} soft />
        <ActionChips pr={pr} compact={false} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0, paddingLeft: 2 }}>
        <IssueCounts pr={pr} />
        {showHeadRef && pr.headRef ? (
          <span
            title={pr.headRef}
            style={{
              fontFamily: tokens.mono,
              fontSize: 11,
              color: tokens.muted,
              minWidth: 0,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pr.headRef}
          </span>
        ) : null}
        {pr.ticketIds.length > 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            {pr.ticketIds.map((t) => (
              <Pill key={t} label={t} tone={tokens.muted} />
            ))}
          </span>
        ) : null}
        {localDiffersFromPrHead ? (
          <Pill
            label="local differs from PR head"
            tone={statusColors.cached}
            soft
            title="your local branch tip differs from the pushed PR head — fetch or push to sync"
          />
        ) : null}
        <span style={{ flex: 1 }} />
        {updated ? (
          <span style={{ fontSize: 11, color: tokens.muted }} title="PR last updated">
            {updated}
          </span>
        ) : null}
      </div>
    </div>
  );
}
