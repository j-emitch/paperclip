/**
 * A board chip — one `PREFIX-NN` ticket placed in a column. Carries its title,
 * a cross-repo badge (only when the chip's repo differs from its lane's home
 * repo), an In-review review-state marker, and a PR deep-link. A chip with a
 * `url` renders as a real `<a>` (keyboard + middle-click native); a chip without
 * one is a focusable group so the board is fully keyboard-scannable.
 */

import type { CSSProperties } from "react";
import type { Chip as ChipModel } from "../../contracts/index.js";
import { columnAccent, statusColors, tokens } from "../tokens.js";
import { CheckIcon, ExternalLinkIcon } from "../icons.js";
import { Dot } from "../shared/badges.js";
import { relativeTime } from "./view-model.js";

const REVIEW_VISUAL: Record<
  Exclude<ChipModel["reviewState"], null>,
  { color: string; label: string }
> = {
  reviewed: { color: statusColors.ship, label: "reviewed" },
  unknown: { color: statusColors.reviewUnknown, label: "no local report" },
  none: { color: statusColors.reviewUnknown, label: "no report" },
};

const baseStyle: CSSProperties = {
  display: "block",
  textDecoration: "none",
  color: tokens.fg,
  background: tokens.cardElevated,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radiusSm,
  padding: "7px 9px",
  cursor: "default",
  outline: "none",
};

export function Chip({
  chip,
  laneHomeRepo,
  now,
  index = 0,
}: {
  chip: ChipModel;
  laneHomeRepo: string | null;
  now: number;
  index?: number;
}) {
  const crossRepo = laneHomeRepo !== null && chip.repo !== laneHomeRepo;
  const review = chip.reviewState ? REVIEW_VISUAL[chip.reviewState] : null;
  const moved = relativeTime(chip.updatedAt, now);
  const isLink = chip.url !== null && chip.url !== "";

  const ariaParts = [
    chip.id,
    chip.title ?? "",
    crossRepo ? `in ${chip.repo}` : "",
    chip.prNumber !== null ? `PR ${chip.prNumber}` : "",
    review ? `review ${review.label}` : "",
    moved ? `updated ${moved}` : "",
  ].filter(Boolean);
  const ariaLabel = ariaParts.join(", ");

  const inner = (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: tokens.mono, fontSize: 12, fontWeight: 700, color: tokens.fg, letterSpacing: 0.2 }}>
          {chip.id}
        </span>
        {crossRepo ? <RepoBadge repo={chip.repo} /> : null}
        {chip.prNumber !== null ? (
          <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted }}>#{chip.prNumber}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {review ? <ReviewMark color={review.color} reviewed={chip.reviewState === "reviewed"} /> : null}
        {isLink ? (
          <span aria-hidden="true" style={{ color: tokens.muted, display: "inline-flex" }}>
            <ExternalLinkIcon size={12} />
          </span>
        ) : null}
      </span>
      {chip.title ? (
        <span
          style={{
            marginTop: 3,
            fontSize: 12.5,
            lineHeight: 1.35,
            color: tokens.fg,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          } as CSSProperties}
        >
          {chip.title}
        </span>
      ) : null}
      {moved ? (
        <span style={{ display: "block", marginTop: 4, fontSize: 10.5, color: tokens.muted }}>{moved}</span>
      ) : null}
    </>
  );

  // Stagger the entrance subtly by column position; capped so deep columns don't lag.
  // The left "status spine" colors the chip by its column so state reads at a glance.
  const style: CSSProperties = {
    ...baseStyle,
    borderLeft: `3px solid ${columnAccent[chip.column]}`,
    animationDelay: `${Math.min(index, 6) * 28}ms`,
  };

  if (isLink) {
    return (
      <a
        className="cos-chip"
        href={chip.url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...style, cursor: "pointer" }}
        aria-label={`${ariaLabel} — open link`}
        title={chip.title ?? chip.id}
      >
        {inner}
      </a>
    );
  }
  return (
    <div
      className="cos-chip"
      role="group"
      tabIndex={0}
      style={style}
      aria-label={ariaLabel}
      title={chip.title ?? chip.id}
    >
      {inner}
    </div>
  );
}

function RepoBadge({ repo }: { repo: string }) {
  return (
    <span
      aria-label={`repo ${repo}`}
      style={{
        fontSize: 10,
        fontFamily: tokens.mono,
        fontWeight: 600,
        color: tokens.accent,
        background: tokens.accentSoft,
        border: `1px solid ${tokens.accentBorder}`,
        borderRadius: 4,
        padding: "0 5px",
        lineHeight: "16px",
        whiteSpace: "nowrap",
      }}
    >
      {repo}
    </span>
  );
}

function ReviewMark({ color, reviewed }: { color: string; reviewed: boolean }) {
  if (reviewed) {
    return (
      <span aria-hidden="true" style={{ display: "inline-flex", color }}>
        <CheckIcon size={13} />
      </span>
    );
  }
  return <Dot tone={color} size={7} />;
}
