/**
 * `BranchRow` — one branch in the Source tree (spec §5.1), expandable to its
 * recent commits. The header shows the branch name (or a "detached" chip when
 * `branch===null`), the derived health flags as toned chips (the authoritative
 * `statuses[]` — which already encodes conflict + comparison state, so we never
 * double-render those), the ahead/behind + staleness magnitudes, the last-commit
 * age, and a per-worktree dirty badge. Expanding reveals the `CommitList`.
 *
 * Local collapse state (default collapsed; `defaultExpanded` lets the harness
 * screenshot an open row) — pure + SSR-faithful, like the board's lanes.
 */

import { useState } from "react";
import type { BranchGitV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CaretIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { BRANCH_COMPARISON_LABELS, BRANCH_STATUS_LABELS, BRANCH_STATUS_TONES } from "../shared/git-labels.js";
import { WorktreeBadge } from "./WorktreeBadge.js";
import { CommitList } from "./CommitList.js";

export interface BranchRowProps {
  branch: BranchGitV1;
  now: number;
  isMobile?: boolean;
  defaultExpanded?: boolean;
}

export function BranchRow({ branch, now, isMobile = false, defaultExpanded = false }: BranchRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const inSync = branch.comparison === "ok" && (branch.ahead ?? 0) === 0 && (branch.behind ?? 0) === 0;
  const lastCommitAge = relativeTime(branch.lastCommitAt, now);

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
    title: branch.recentCommits.length > 0 ? `${expanded ? "Collapse" : "Expand"} recent commits` : undefined,
  };

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusSm, background: tokens.card, overflow: "hidden" }}>
      {isMobile ? (
        // Mobile: header line (caret + name + magnitudes) over a chips line, so the
        // branch name + flags + ahead/behind never collide on a narrow viewport.
        <button {...buttonProps} style={{ ...buttonBase, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, width: "100%" }}>
            {caret}
            {branchName}
            {magnitudes}
          </div>
          {(!inSync && branch.statuses.length > 0) || inSync ? <div style={{ paddingLeft: 22, width: "100%" }}>{statusChips}</div> : null}
        </button>
      ) : (
        <button {...buttonProps} style={{ ...buttonBase, display: "flex", alignItems: "center", gap: 9 }}>
          {caret}
          {branchName}
          {statusChips}
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
        <div className="cos-fx-fade" style={{ borderTop: `1px solid ${tokens.border}`, background: tokens.bg, padding: "8px 11px 9px" }}>
          <CommitList commits={branch.recentCommits} now={now} />
        </div>
      ) : null}
    </div>
  );
}
