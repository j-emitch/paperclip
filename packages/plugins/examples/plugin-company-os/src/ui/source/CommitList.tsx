/**
 * `CommitList` — a branch tip's recent commits (spec §5.1): sha · subject ·
 * author · age, plus the `--shortstat` files/insertions/deletions when present.
 * Shown when a `BranchRow` is expanded. Pure + deterministic (an injected `now`).
 */

import type { CommitRefV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { relativeTime } from "../shared/time.js";

const SHORT_SHA = 7;

export function CommitList({ commits, now }: { commits: readonly CommitRefV1[]; now: number }) {
  if (commits.length === 0) {
    return <p style={{ margin: 0, fontSize: 12, color: tokens.muted, fontStyle: "italic" }}>No recent commits.</p>;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 }}>
      {commits.map((commit) => (
        <CommitRow key={commit.sha} commit={commit} now={now} />
      ))}
    </ul>
  );
}

function CommitRow({ commit, now }: { commit: CommitRefV1; now: number }) {
  const age = relativeTime(commit.committedAt, now);
  return (
    <li style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "5px 8px", minWidth: 0 }}>
      <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.accent, fontWeight: 600, flex: "0 0 auto" }}>
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
      {commit.stat ? (
        <span style={{ fontSize: 10.5, color: tokens.muted, whiteSpace: "nowrap", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>
          <span title={`${commit.stat.filesChanged} files changed`}>{commit.stat.filesChanged}f</span>{" "}
          <span style={{ color: statusColors.ship }} title={`${commit.stat.insertions} insertions`}>+{commit.stat.insertions}</span>{" "}
          <span style={{ color: statusColors.danger }} title={`${commit.stat.deletions} deletions`}>−{commit.stat.deletions}</span>
        </span>
      ) : null}
      <span style={{ fontSize: 11, color: tokens.muted, whiteSpace: "nowrap", flex: "0 0 auto" }}>{commit.author}</span>
      {age ? (
        <span style={{ fontSize: 11, color: tokens.muted, whiteSpace: "nowrap", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>{age}</span>
      ) : null}
    </li>
  );
}
