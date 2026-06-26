/**
 * `ProvenanceBadge` — where an indexed doc was read from (spec §5.4/§6.3): the
 * main checkout, or a specific worktree (basename @ branch). The worktree case is
 * tinted so a doc that only exists on an in-flight worktree (e.g. this COS-1 spec
 * on `cos-COS-1 @ docs/COS-1`) reads as distinct from a committed main-checkout
 * doc. The absolute worktree path never leaks — only the basename provenance.
 */

import type { DocEntryV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";

export function ProvenanceBadge({ entry }: { entry: DocEntryV1 }) {
  const isWorktree = entry.provenance === "worktree";
  const tone = isWorktree ? statusColors.cached : tokens.muted;
  const label = isWorktree
    ? `worktree: ${entry.worktreeName ?? "?"}${entry.branch ? ` @ ${entry.branch}` : ""}`
    : "main";
  return (
    <span
      title={isWorktree ? `Read from worktree ${entry.worktreeName ?? "?"}${entry.branch ? ` on branch ${entry.branch}` : ""}` : "Read from the main checkout"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: tokens.mono,
        color: tone,
        background: tokens.secondary,
        border: `1px solid ${tokens.border}`,
        whiteSpace: "nowrap",
        maxWidth: 280,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <Dot tone={tone} size={6} />
      {label}
    </span>
  );
}
