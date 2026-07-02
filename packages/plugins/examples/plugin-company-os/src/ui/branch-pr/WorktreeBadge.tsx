/**
 * `WorktreeBadge` — one worktree of a branch, with its PER-worktree dirty state
 * (spec §5.1). Shows the worktree dir basename (never the absolute host path —
 * the contract only ever carries the basename), a detached chip when the worktree
 * is on a detached HEAD, and a dirty/clean/unknown dot. Pure + deterministic.
 */

import type { WorktreeGitV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";

export function WorktreeBadge({ worktree }: { worktree: WorktreeGitV1 }) {
  const dirty = worktree.dirtyFileCount;
  const { label, tone } =
    dirty === null
      ? { label: "dirty unknown", tone: tokens.muted }
      : dirty > 0
        ? { label: `${dirty} dirty`, tone: statusColors.cached }
        : { label: "clean", tone: statusColors.ship };

  return (
    <span
      title={`worktree ${worktree.name}${worktree.detached ? " · detached HEAD" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        background: tokens.secondary,
        border: `1px solid ${tokens.border}`,
        whiteSpace: "nowrap",
        maxWidth: 220,
        minWidth: 0,
      }}
    >
      <code
        style={{
          fontFamily: tokens.mono,
          fontSize: 10.5,
          fontWeight: 600,
          color: tokens.fg,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {worktree.name}
      </code>
      {worktree.detached ? (
        <span style={{ fontSize: 10, color: tokens.muted, fontStyle: "italic", flex: "0 0 auto" }}>detached</span>
      ) : null}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: tone, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>
        <Dot tone={tone} size={6} />
        {label}
      </span>
    </span>
  );
}
