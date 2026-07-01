/**
 * `OverlapCard` — one duty-surface overlap (spec §7.4): a surface two or more
 * agents both claim, with the ratified proposed owner + the resolution
 * recommendation when the duties matrix has settled it, or a calm "unresolved —
 * see the duties matrix" pointer when it hasn't.
 */

import type { OverlapEdgeV1 } from "../../contracts/index.js";
import { tokens, statusColors } from "../tokens.js";
import { Pill } from "../shared/badges.js";

export function OverlapCard({ overlap }: { overlap: OverlapEdgeV1 }) {
  const resolved = overlap.proposedOwner !== null;
  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        padding: 13,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${resolved ? statusColors.proceed : statusColors.revise}`,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <code
          title={overlap.surface}
          style={{
            fontFamily: tokens.mono,
            fontSize: 12,
            color: tokens.fg,
            background: tokens.secondary,
            padding: "2px 7px",
            borderRadius: 6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {overlap.surface}
        </code>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {overlap.agents.map((agent) => (
            <Pill key={agent} label={agent} tone={tokens.muted} />
          ))}
        </div>
      </div>

      {resolved ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, color: tokens.fg }}>
            Proposed owner:{" "}
            <strong style={{ color: statusColors.proceed, fontWeight: 700 }}>{overlap.proposedOwner}</strong>
          </span>
          {overlap.recommendation ? (
            <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, lineHeight: 1.45 }}>{overlap.recommendation}</p>
          ) : null}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 11.5, color: tokens.muted, lineHeight: 1.45 }}>
          Ownership unresolved — see the agent duties matrix (Docs → 17-agent-duties-matrix).
        </p>
      )}
    </article>
  );
}
