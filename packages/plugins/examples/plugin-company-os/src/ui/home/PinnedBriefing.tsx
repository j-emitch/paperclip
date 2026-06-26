/**
 * `PinnedBriefing` — the company-global routine briefing row (spec §5.3): the
 * CEO / COO / CTO / Librarian outputs Joe pins to read first thing. Each card
 * shows its owning agent, the routine, a verdict pill (the SAME palette as the
 * Routines tab), and how fresh the latest report is; clicking opens it in the
 * in-place drawer. Company-level, so it is NOT project-grouped. Pure — the
 * connected `Home` owns the drawer + the open callback.
 */

import type { BriefingCardV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ClockIcon, ExternalLinkIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { BRIEFING_VERDICT_LABELS, BRIEFING_VERDICT_TONES } from "./home-view-model.js";

export interface PinnedBriefingProps {
  briefing: readonly BriefingCardV1[];
  now: number;
  isMobile?: boolean;
  onOpen?: (card: BriefingCardV1) => void;
}

export function PinnedBriefing({ briefing, now, isMobile = false, onOpen }: PinnedBriefingProps) {
  if (briefing.length === 0) {
    return <CalmNote>No routine briefings pinned yet — the CEO / COO / CTO / Librarian outputs appear here as they run.</CalmNote>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(248px, 1fr))",
        gap: 10,
      }}
    >
      {briefing.map((card) => (
        <BriefingCard key={card.routineKey} card={card} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}

function BriefingCard({ card, now, onOpen }: { card: BriefingCardV1; now: number; onOpen?: (card: BriefingCardV1) => void }) {
  const tone = BRIEFING_VERDICT_TONES[card.verdict];
  const reportAge = relativeTime(card.reportDate, now);
  const openable = card.relPath !== null && onOpen !== undefined;
  return (
    <button
      type="button"
      className="cos-fx-card"
      disabled={!openable}
      onClick={openable ? () => onOpen?.(card) : undefined}
      title={openable ? `Open ${card.displayName}` : `${card.displayName} — no report on this machine yet`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        textAlign: "left",
        minWidth: 0,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        borderLeft: `3px solid ${tone}`,
        color: tokens.fg,
        font: "inherit",
        cursor: openable ? "pointer" : "default",
        opacity: openable ? 1 : 0.72,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: tokens.muted }}>
          {card.ownerAgent}
        </span>
        <span style={{ flex: 1 }} />
        <Pill label={BRIEFING_VERDICT_LABELS[card.verdict]} tone={tone} soft withDot />
      </div>
      <p
        title={card.displayName}
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 650,
          color: tokens.fg,
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {card.displayName}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto", fontSize: 11.5, color: tokens.muted }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            <ClockIcon size={12} />
          </span>
          {reportAge ?? "no report yet"}
        </span>
        {openable ? (
          <span aria-hidden="true" style={{ marginLeft: "auto", display: "inline-flex", color: tone }}>
            <ExternalLinkIcon size={12} />
          </span>
        ) : null}
      </div>
    </button>
  );
}
