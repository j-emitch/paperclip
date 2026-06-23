/**
 * The Ops / Unclassified lane — signals that couldn't be placed on the board,
 * each with a machine reason, the evidence that failed to classify, and an
 * actionable hint ("register COS in prefix-registry.json"). Built on the shared
 * `CollapsibleLane` frame. This lane is the board's honesty surface: nothing is
 * silently dropped — if a branch can't be classified, it lands here with a fix.
 */

import type { Lane, UnclassifiedChip, UnclassifiedReason } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { CollapsibleLane } from "./CollapsibleLane.js";

const REASON_LABELS: Record<UnclassifiedReason, string> = {
  unknown_prefix: "unknown prefix",
  generic_prefix: "generic prefix",
  bad_branch_format: "unparseable branch",
  missing_registry_entry: "no registry entry",
  ambiguous_family: "ambiguous family",
  missing_home_system: "no home system",
};

export function UnclassifiedLane({
  lane,
  chips,
  collapsed,
  onToggle,
  isMobile,
}: {
  lane: Lane;
  chips: UnclassifiedChip[];
  collapsed: boolean;
  onToggle: (laneId: string) => void;
  isMobile: boolean;
}) {
  return (
    <CollapsibleLane
      laneId={lane.id}
      collapsed={collapsed}
      onToggle={onToggle}
      isMobile={isMobile}
      borderColor={`color-mix(in oklch, ${statusColors.generic} 26%, ${tokens.border})`}
      toggleLabel={`${collapsed ? "Expand" : "Collapse"} the ${lane.title} lane`}
      header={
        <span
          style={{ fontSize: 14, fontWeight: 650, color: tokens.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
        >
          {lane.title}
        </span>
      }
      trailing={
        <span
          aria-label={`${chips.length} unclassified signal${chips.length === 1 ? "" : "s"}`}
          style={{ fontSize: 12, color: chips.length > 0 ? statusColors.generic : tokens.muted, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        >
          {chips.length}
        </span>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {chips.length === 0 ? (
          <p style={{ margin: "6px 2px", fontSize: 12.5, color: tokens.muted }}>0 unclassified signals.</p>
        ) : (
          chips.map((chip, i) => <UnclassifiedRow key={`${chip.repo}:${chip.id}:${i}`} chip={chip} />)
        )}
      </div>
    </CollapsibleLane>
  );
}

function UnclassifiedRow({ chip }: { chip: UnclassifiedChip }) {
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={`${chip.id} in ${chip.repo}: ${REASON_LABELS[chip.reason]}${chip.hint ? ` — ${chip.hint}` : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 10px",
        borderRadius: tokens.radiusSm,
        background: tokens.cardElevated,
        border: `1px solid ${tokens.border}`,
        outline: "none",
        minWidth: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: tokens.mono, fontSize: 12, fontWeight: 700, color: tokens.fg }}>{chip.id}</span>
        <span style={{ fontSize: 10, fontFamily: tokens.mono, color: tokens.muted }}>{chip.repo}</span>
        <ReasonBadge reason={chip.reason} />
        {chip.prefix ? (
          <span style={{ fontSize: 10.5, fontFamily: tokens.mono, color: tokens.muted }}>prefix “{chip.prefix}”</span>
        ) : null}
      </span>
      {chip.evidence ? (
        <span
          style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {chip.evidence}
        </span>
      ) : null}
      {chip.hint ? (
        <span style={{ fontSize: 11.5, color: tokens.accent, overflow: "hidden", wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          → {chip.hint}
        </span>
      ) : null}
    </div>
  );
}

function ReasonBadge({ reason }: { reason: UnclassifiedReason }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        fontSize: 10,
        fontWeight: 600,
        fontFamily: tokens.mono,
        color: statusColors.generic,
        background: "color-mix(in oklch, " + statusColors.generic + " 15%, transparent)",
        border: `1px solid color-mix(in oklch, ${statusColors.generic} 40%, transparent)`,
        borderRadius: 4,
        padding: "0 5px",
        lineHeight: "16px",
      }}
    >
      {REASON_LABELS[reason]}
    </span>
  );
}
