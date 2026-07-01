/**
 * `HandoffLedger` — the A→B hand-off rows (spec §7.4). Each declared hand-off is
 * one divider-separated row with a consistency dot: green when the receiver lists
 * the sender in `receivesFrom`, amber with an explicit callout when it doesn't
 * (the mismatch the projection also raises as a diagnostic). Doubles as the
 * mobile hand-off legend for the constellation.
 */

import type { HandoffEdgeV1 } from "../../contracts/index.js";
import { tokens, statusColors } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";

export function HandoffLedger({ handoffs }: { handoffs: readonly HandoffEdgeV1[] }) {
  if (handoffs.length === 0) {
    return <CalmNote tone={statusColors.ship}>No hand-offs declared — every agent works its own lane.</CalmNote>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {handoffs.map((handoff, i) => (
        <div
          key={handoff.from + ">" + handoff.to + "#" + i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 2px",
            borderTop: i > 0 ? `1px solid ${tokens.border}` : undefined,
            minWidth: 0,
          }}
        >
          <Dot tone={handoff.consistent ? statusColors.ship : statusColors.revise} />
          <span style={{ fontSize: 12.5, color: tokens.fg, fontWeight: 600, whiteSpace: "nowrap" }}>
            {handoff.from} → {handoff.to}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: handoff.consistent ? tokens.muted : statusColors.revise, textAlign: "right" }}>
            {handoff.consistent ? "consistent" : handoff.to + " does not list " + handoff.from}
          </span>
        </div>
      ))}
    </div>
  );
}
