/**
 * `RecentCommitsGlance` — a flat, newest-first feed of the latest commits across
 * every branch (spec §5.3). Unlike the project-grouped panels this is a time-
 * ordered glance ("what just landed"), so it reads as one chronological list with
 * a repo badge per row rather than per-project sections. Read-only (the full
 * per-branch commit history lives in the Source tab). Pure + deterministic.
 */

import type { CommitGlanceV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { relativeTime, safeTime } from "../shared/time.js";

const SHORT_SHA = 7;

export interface RecentCommitsGlanceProps {
  recentCommits: readonly CommitGlanceV1[];
  now: number;
}

export function RecentCommitsGlance({ recentCommits, now }: RecentCommitsGlanceProps) {
  if (recentCommits.length === 0) {
    return <CalmNote>No commits in the recent window.</CalmNote>;
  }
  const ordered = [...recentCommits].sort((a, b) => safeTime(b.committedAt) - safeTime(a.committedAt));
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      {ordered.map((commit, i) => (
        <CommitRow key={`${commit.repo}:${commit.sha}:${i}`} commit={commit} now={now} />
      ))}
    </ul>
  );
}

function CommitRow({ commit, now }: { commit: CommitGlanceV1; now: number }) {
  const age = relativeTime(commit.committedAt, now);
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 10px",
        minWidth: 0,
        borderRadius: tokens.radiusSm,
        border: `1px solid transparent`,
      }}
    >
      <code style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.accent, fontWeight: 600, flex: "0 0 auto" }}>
        {commit.sha.slice(0, SHORT_SHA)}
      </code>
      <span
        title={commit.subject}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          color: tokens.fg,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {commit.subject || <span style={{ color: tokens.muted, fontStyle: "italic" }}>(no subject)</span>}
      </span>
      {commit.branch ? (
        <code
          title={commit.branch}
          style={{
            fontFamily: tokens.mono,
            fontSize: 10.5,
            color: tokens.muted,
            maxWidth: 150,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "0 0 auto",
          }}
        >
          {commit.branch}
        </code>
      ) : null}
      <RepoBadge repo={commit.repo} />
      {age ? (
        <span style={{ fontSize: 11, color: tokens.muted, whiteSpace: "nowrap", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>
          {age}
        </span>
      ) : null}
    </li>
  );
}
