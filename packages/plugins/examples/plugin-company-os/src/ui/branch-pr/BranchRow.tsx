/**
 * `BranchRow` — one branch in the Branch·PR Health tree (spec §5.1), expandable to
 * its open PRs + recent commits. The header shows the branch name (or a "detached"
 * chip when `branch===null`), the derived health flags as toned chips (the
 * authoritative `statuses[]` — which already encodes conflict + comparison state, so
 * we never double-render those), a compact PR cue (its primary open PR's number +
 * lifecycle + review verdict, COS-5e), the ahead/behind + staleness magnitudes, the
 * last-commit age, and a per-worktree dirty badge. Expanding reveals each open PR's
 * detail (verdict, findings, local-ahead note) then the `CommitList`.
 *
 * Local collapse state (default collapsed; `defaultExpanded` lets the harness
 * screenshot an open row) — pure + SSR-faithful, like the board's lanes.
 */

import { useEffect, useRef, useState } from "react";
import type { BranchGitV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CaretIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { BRANCH_COMPARISON_LABELS, BRANCH_STATUS_LABELS, BRANCH_STATUS_TONES } from "../shared/git-labels.js";
import { WorktreeBadge } from "./WorktreeBadge.js";
import { CommitList } from "./CommitList.js";
import { PrChip, PrDetailRow } from "./PrChip.js";
import { HeadReviewChip, HeadReviewsDetail } from "./HeadReviews.js";

export interface BranchRowProps {
  branch: BranchGitV1;
  now: number;
  isMobile?: boolean;
  defaultExpanded?: boolean;
}

/** A small uppercase section label inside the expanded body. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tokens.muted }}>
      {children}
    </div>
  );
}

export function BranchRow({ branch, now, isMobile = false, defaultExpanded = false }: BranchRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Open + scroll into view when this row becomes the focus target — both on mount
  // (a consumed Home deep-link) and later (an in-view attention-band click flips
  // `defaultExpanded` true). Only ever opens on true, so it never force-collapses a
  // row the user opened by hand. `block:"center"` (no smooth) is reduced-motion-safe.
  useEffect(() => {
    if (defaultExpanded) {
      setExpanded(true);
      rootRef.current?.scrollIntoView({ block: "center" });
    }
  }, [defaultExpanded]);
  // "in sync" only when there's genuinely nothing to flag — a dirty/stale branch
  // at ahead=0/behind=0 must still show its status chips, not collapse to a calm
  // "in sync" pill (codex B).
  const inSync = branch.comparison === "ok" && (branch.ahead ?? 0) === 0 && (branch.behind ?? 0) === 0 && branch.statuses.length === 0;
  const lastCommitAge = relativeTime(branch.lastCommitAt, now);
  const prs = branch.pullRequests;
  const primary = prs.length > 0 ? prs[0] : null;
  const hasDetail = branch.recentCommits.length > 0 || prs.length > 0;

  const caret = (
    <span
      aria-hidden="true"
      className="cos-fx-caret"
      style={{ display: "inline-flex", color: tokens.muted, flex: "0 0 auto", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <CaretIcon size={13} />
    </span>
  );
  const branchName =
    branch.branch !== null ? (
      <code
        title={branch.branch}
        style={{
          fontFamily: tokens.mono,
          fontSize: 12,
          fontWeight: 600,
          color: tokens.fg,
          maxWidth: isMobile ? "none" : 280,
          flex: isMobile ? 1 : "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {branch.branch}
      </code>
    ) : (
      <span style={{ fontSize: 11.5, color: tokens.muted, fontStyle: "italic", flex: isMobile ? 1 : "0 0 auto" }}>detached</span>
    );
  const statusChips = (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
      {inSync ? (
        <Pill label="in sync" tone={tokens.muted} />
      ) : (
        // The specific `comparison` reason is shown structurally, so the generic
        // `comparison_unavailable` chip is dropped to avoid duplication.
        branch.statuses
          .filter((status) => status !== "comparison_unavailable")
          .map((status) => <Pill key={status} label={BRANCH_STATUS_LABELS[status]} tone={BRANCH_STATUS_TONES[status]} soft />)
      )}
    </div>
  );
  // Compact PR cue — the primary open PR + a "+N" when a branch has several.
  const prCue = primary ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <PrChip pr={primary} />
      {prs.length > 1 ? (
        <span style={{ fontSize: 11, color: tokens.muted }} title={`${prs.length} open PRs on this branch`}>
          +{prs.length - 1}
        </span>
      ) : null}
    </span>
  ) : null;
  // COS-8d: the head-review cue — present only when a report joined this tip.
  const reviewCue = <HeadReviewChip reviews={branch.reviewsForHead} />;
  const magnitudes = (
    <span style={{ display: "flex", alignItems: "center", gap: 9, flex: "0 0 auto", fontSize: 11.5, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
      {branch.comparison === "ok" ? (
        !inSync ? (
          <span title={`${branch.ahead ?? 0} ahead, ${branch.behind ?? 0} behind trunk`}>
            ↑{branch.ahead ?? 0} ↓{branch.behind ?? 0}
          </span>
        ) : null
      ) : (
        <span title="branch could not be compared to its trunk" style={{ fontStyle: "italic" }}>
          {BRANCH_COMPARISON_LABELS[branch.comparison]}
        </span>
      )}
      {branch.staleDays > 0 ? <span title={`${branch.staleDays} days since last commit`}>{branch.staleDays}d</span> : null}
      {lastCommitAge ? <span title="last commit">{lastCommitAge}</span> : null}
    </span>
  );

  const buttonBase = {
    padding: "9px 11px",
    width: "100%",
    minWidth: 0,
    textAlign: "left" as const,
    background: "transparent",
    border: "none",
    color: tokens.fg,
    font: "inherit",
    cursor: "pointer",
  };
  const buttonProps = {
    type: "button" as const,
    className: "cos-fx-row",
    "aria-expanded": expanded,
    onClick: () => setExpanded((v) => !v),
    title: hasDetail ? `${expanded ? "Collapse" : "Expand"} PR + commit detail` : undefined,
  };

  return (
    <div ref={rootRef} style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusSm, background: tokens.card, overflow: "hidden" }}>
      {isMobile ? (
        // Mobile: header line (caret + name + magnitudes) over a chips line, so the
        // branch name + flags + PR cue + ahead/behind never collide on a narrow viewport.
        <button {...buttonProps} style={{ ...buttonBase, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, width: "100%" }}>
            {caret}
            {branchName}
            {magnitudes}
          </div>
          {inSync || branch.statuses.length > 0 || prCue || branch.reviewsForHead.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingLeft: 22, width: "100%" }}>
              {statusChips}
              {prCue}
              {reviewCue}
            </div>
          ) : null}
        </button>
      ) : (
        <button {...buttonProps} style={{ ...buttonBase, display: "flex", alignItems: "center", gap: 9 }}>
          {caret}
          {branchName}
          {statusChips}
          {prCue}
          {reviewCue}
          <span style={{ flex: 1 }} />
          {magnitudes}
        </button>
      )}

      {branch.worktrees.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 11px 9px 33px", minWidth: 0 }}>
          {branch.worktrees.map((wt) => (
            <WorktreeBadge key={`${wt.name}:${wt.headSha}`} worktree={wt} />
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div
          className="cos-fx-fade"
          style={{ borderTop: `1px solid ${tokens.border}`, background: tokens.bg, padding: "9px 11px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <SectionLabel>Head review</SectionLabel>
            <HeadReviewsDetail reviews={branch.reviewsForHead} now={now} />
          </div>
          {prs.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <SectionLabel>{prs.length === 1 ? "Open PR" : `Open PRs (${prs.length})`}</SectionLabel>
              {prs.map((pr) => (
                <PrDetailRow key={pr.prNumber} pr={pr} now={now} branchHeadSha={branch.headSha} />
              ))}
            </div>
          ) : null}
          {branch.recentCommits.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <SectionLabel>Recent commits</SectionLabel>
              <CommitList commits={branch.recentCommits} now={now} />
            </div>
          ) : prs.length === 0 ? (
            <CommitList commits={branch.recentCommits} now={now} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
