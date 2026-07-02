/**
 * `BranchHealthPanel` — Home's SLIM branch-health cue (COS-5e). The full per-branch,
 * worst-first, deep-linkable audit RELOCATED to the dedicated Branch · PR Health tab;
 * Home keeps only a one-line "N branches need attention →" alert link into it (D6:
 * functionality relocated, not lost) plus a calm 0-state when everything is healthy.
 * Pure — the parent supplies the count + the navigation.
 */

import { statusColors, tokens } from "../tokens.js";
import { CalmNote } from "../shared/feedback.js";

export interface BranchHealthPanelProps {
  /** Branches needing attention (orientation's alert-worthy `branchHealth` count). */
  count: number;
  /** Navigate to the Branch · PR Health tab (where the full detail lives now). */
  onOpen?: () => void;
}

export function BranchHealthPanel({ count, onOpen }: BranchHealthPanelProps) {
  if (count === 0) {
    return <CalmNote tone={statusColors.ship}>All branches healthy — nothing needs attention.</CalmNote>;
  }
  const label = `${count} branch${count === 1 ? "" : "es"} need${count === 1 ? "s" : ""} attention`;
  return (
    <button
      type="button"
      className="cos-fx-row"
      onClick={onOpen}
      title="Open Branch · PR Health"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minWidth: 0,
        padding: "10px 12px",
        textAlign: "left",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${statusColors.stale}`,
        borderRadius: tokens.radiusSm,
        color: tokens.fg,
        font: "inherit",
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span aria-hidden="true" className="cos-fx-row-go" style={{ color: statusColors.stale, fontSize: 15, lineHeight: 1 }}>
        →
      </span>
    </button>
  );
}
