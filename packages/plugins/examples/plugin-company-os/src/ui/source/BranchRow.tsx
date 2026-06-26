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
  defaultExpanded?: boolean;
}

export function BranchRow({ branch, now, defaultExpanded = false }: BranchRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const inSync = branch.comparison === "ok" && (branch.ahead ?? 0) === 0 && (branch.behind ?? 0) === 0;
  const lastCommitAge = relativeTime(branch.lastCommitAt, now);

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: tokens.radiusSm, background: tokens.card, overflow: "hidden" }}>
      <button
        type="button"
        className="cos-fx-row"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        title={branch.recentCommits.length > 0 ? `${expanded ? "Collapse" : "Expand"} recent commits` : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px 11px",
          width: "100%",
          minWidth: 0,
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: tokens.fg,
          font: "inherit",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          className="cos-fx-caret"
          style={{
            display: "inline-flex",
            color: tokens.muted,
            flex: "0 0 auto",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        >
          <CaretIcon size={13} />
        </span>
        {branch.branch !== null ? (
          <code
            title={branch.branch}
            style={{
              fontFamily: tokens.mono,
              fontSize: 12,
              fontWeight: 600,
              color: tokens.fg,
              maxWidth: 280,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
            }}
          >
            {branch.branch}
          </code>
        ) : (
          <span style={{ fontSize: 11.5, color: tokens.muted, fontStyle: "italic", flex: "0 0 auto" }}>detached</span>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
          {inSync ? (
            <Pill label="in sync" tone={tokens.muted} />
          ) : (
            // The specific `comparison` reason is shown structurally below, so the
            // generic `comparison_unavailable` chip is dropped to avoid duplication.
            branch.statuses
              .filter((status) => status !== "comparison_unavailable")
              .map((status) => <Pill key={status} label={BRANCH_STATUS_LABELS[status]} tone={BRANCH_STATUS_TONES[status]} soft />)
          )}
        </div>

        <span style={{ flex: 1 }} />

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
      </button>

      {branch.worktrees.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 11px 9px 33px", minWidth: 0 }}>
          {branch.worktrees.map((wt) => (
            <WorktreeBadge key={`${wt.name}:${wt.headSha}`} worktree={wt} />
          ))}
        </div>
      ) : null}

      {expanded ? (
        <div style={{ borderTop: `1px solid ${tokens.border}`, background: tokens.bg, padding: "8px 11px 9px" }}>
          <CommitList commits={branch.recentCommits} now={now} />
        </div>
      ) : null}
    </div>
  );
}
