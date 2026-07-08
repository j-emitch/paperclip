/**
 * `WorktreesLens` — the Worktrees half of the Branch·PR tab (COS-8c / spec
 * §5.2). Pure + SSR-faithful: renders the `WorktreeBoardV1` payload as
 * per-repo sections — header with the ACTIVITY-GATE DENOMINATOR ("evaluated
 * N/M (activity-gated)") and any skipped-dirty names (never silent, AC-8c#3)
 * — over a four-lane board. Cards carry the origin badge, git truth
 * (dirty/ahead/behind), the resolving intent-ladder RUNG, the COH artifacts
 * (tickets, checkpoints, handoff), the cleanup receipt (coh promote vs
 * raw-git, item 1), and a docs-updated chip whose click hands the FIRST
 * changed doc to the 8f URL machinery (the connected parent wires `onOpenDoc`).
 */

import { useEffect, useRef } from "react";
import type { OverlapPairV1, WorktreeBoardV1, WorktreeCardV1, WorktreeRepoSectionV1 } from "../../contracts/worktree-board.js";
import type { WorktreeLane, WorktreeOrigin } from "../../contracts/vocab.js";

// UI-local lane display order (the UI import boundary forbids VALUE imports
// from contracts). The Record maps below are keyed by WorktreeLane, so a vocab
// change still fails compile here — no silent drift.
const LANE_DISPLAY_ORDER: readonly WorktreeLane[] = ["needs_attention", "in_flight", "merged_cleanup", "stale"];
import { statusColors, tokens, springTransition } from "../tokens.js";
import { Pill, RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ClockIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { DOC_FILE_RE } from "../../shared/doc-files.js";

/** The `?tab=branch-pr&wt=…` deep-link target: which card to focus. */
export interface WorktreeFocus {
  repoKey: string;
  wt: string;
  ck: string | null;
}

/** Exact-match a card against the deep-link focus (ck narrows when present). */
function matchesFocus(card: WorktreeCardV1, focus: WorktreeFocus): boolean {
  if (!card.hasWorktree || card.repoKey !== focus.repoKey || card.worktreeName !== focus.wt) return false;
  if (focus.ck === null) return true;
  return (card.checkoutKey ?? "").endsWith(`::wt::${focus.ck}`);
}

export const LANE_LABELS: Record<WorktreeLane, string> = {
  needs_attention: "Needs attention",
  in_flight: "In flight",
  merged_cleanup: "Merged · cleanup",
  stale: "Stale",
};

const LANE_TONES: Record<WorktreeLane, string> = {
  needs_attention: statusColors.danger,
  in_flight: statusColors.proceed,
  merged_cleanup: statusColors.ship,
  stale: tokens.muted,
};

const ORIGIN_TONES: Record<WorktreeOrigin, string> = {
  claude: tokens.accent,
  codex: statusColors.reviewUnknown,
  external: tokens.muted,
};

export interface WorktreesLensProps {
  board: WorktreeBoardV1;
  now: number;
  isMobile?: boolean;
  /** Open one changed doc in the Docs surface (the 8f URL machinery). */
  onOpenDoc?: (card: WorktreeCardV1, relPath: string) => void;
  /** Deep-link focus target (?tab=branch-pr&wt=…) — highlight or typed miss. */
  focusWt?: WorktreeFocus | null;
  /** Copy a card's durable wt-link (the connected parent owns clipboard+toast). */
  onCopyLink?: (card: WorktreeCardV1) => void;
}

export function WorktreesLens({ board, now, isMobile = false, onOpenDoc, focusWt = null, onCopyLink }: WorktreesLensProps) {
  const total = board.repos.reduce((sum, r) => sum + r.cards.length, 0);
  const focusMatched =
    focusWt !== null && board.repos.some((r) => r.cards.some((c) => matchesFocus(c, focusWt)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      {focusWt && !focusMatched ? (
        <CalmNote tone={statusColors.reviewUnknown}>
          No worktree “{focusWt.wt}” on the {focusWt.repoKey} board right now — it may have been merged and cleaned up
          since this link was copied.
        </CalmNote>
      ) : null}
      {total === 0 ? (
        <CalmNote>No worktrees or in-flight branches right now — spawn one and it appears on the next derive.</CalmNote>
      ) : null}
      {board.repos.map((section) => (
        <RepoSection
          key={section.repoKey}
          section={section}
          now={now}
          isMobile={isMobile}
          onOpenDoc={onOpenDoc}
          focusWt={focusWt}
          onCopyLink={onCopyLink}
        />
      ))}
    </div>
  );
}

function RepoSection({
  section,
  now,
  isMobile,
  onOpenDoc,
  focusWt,
  onCopyLink,
}: {
  section: WorktreeRepoSectionV1;
  now: number;
  isMobile: boolean;
  onOpenDoc?: (card: WorktreeCardV1, relPath: string) => void;
  focusWt?: WorktreeFocus | null;
  onCopyLink?: (card: WorktreeCardV1) => void;
}) {
  const laneCounts = new Map<WorktreeLane, number>(LANE_DISPLAY_ORDER.map((lane) => [lane, 0]));
  for (const card of section.cards) laneCounts.set(card.lane, (laneCounts.get(card.lane) ?? 0) + 1);

  return (
    <section aria-label={`${section.repoKey} worktrees`} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <RepoBadge repo={section.repoKey} />
        <span style={{ fontSize: 12, color: tokens.muted }}>
          evaluated {section.evaluated}/{section.total} (activity-gated)
        </span>
        {/* Show-0-counts: every lane's count is visible even when its group collapses. */}
        <span style={{ display: "inline-flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          {LANE_DISPLAY_ORDER.map((lane) => (
            <Pill key={lane} label={`${LANE_LABELS[lane]} ${laneCounts.get(lane) ?? 0}`} tone={LANE_TONES[lane]} soft />
          ))}
        </span>
      </header>
      {section.skippedDirty.length > 0 ? (
        <CalmNote tone={statusColors.reviewUnknown}>
          {section.skippedDirty.length} DIRTY tree{section.skippedDirty.length === 1 ? "" : "s"} not evaluated (diff
          budget, or a failed git read): {section.skippedDirty.join(", ")} — refresh to re-evaluate.
        </CalmNote>
      ) : null}
      <ConflictRadar pairs={section.overlapPairs} />
      {LANE_DISPLAY_ORDER.map((lane) => {
        const cards = section.cards.filter((c) => c.lane === lane);
        if (cards.length === 0) return null;
        return (
          <div key={lane} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 650, letterSpacing: 0.4, textTransform: "uppercase", color: LANE_TONES[lane] }}>
              {LANE_LABELS[lane]} · {cards.length}
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 10,
                minWidth: 0,
              }}
            >
              {cards.map((card) => (
                <WorktreeCard
                  key={card.cardKey}
                  card={card}
                  now={now}
                  onOpenDoc={onOpenDoc}
                  focused={focusWt != null && matchesFocus(card, focusWt)}
                  onCopyLink={onCopyLink}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/**
 * COS-8g conflict radar: overlapping in-flight changes, count-ranked; a pair
 * where BOTH sides are dirty is HOT (danger tone). Explicit empty state — a
 * silent absence would read as "not computed".
 */
function ConflictRadar({ pairs }: { pairs: readonly OverlapPairV1[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 12, fontWeight: 650, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>
        Conflict radar
      </h3>
      {pairs.length === 0 ? (
        <span style={{ fontSize: 12, color: tokens.muted }}>No overlapping in-flight changes.</span>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {pairs.map((pair, i) => {
            const tone = pair.bothDirty ? statusColors.danger : tokens.muted;
            const shown = pair.sharedFiles.slice(0, 3);
            const more = pair.count - shown.length;
            return (
              <li
                // Index-qualified: pair labels are DISPLAY names and can collide
                // (duplicate-basename detached trees) even when the cards differ.
                key={`${i}:${pair.branchA}|${pair.branchB}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  padding: "6px 10px",
                  borderRadius: tokens.radiusSm,
                  border: `1px solid ${pair.bothDirty ? tone : tokens.border}`,
                  background: pair.bothDirty ? "color-mix(in srgb, currentColor 4%, transparent)" : tokens.card,
                  color: tone,
                  fontSize: 12,
                }}
              >
                {pair.bothDirty ? <Pill label="HOT · both dirty" tone={statusColors.danger} withDot /> : null}
                <code style={{ fontFamily: tokens.mono, fontSize: 11.5, color: tokens.fg }}>
                  {pair.branchA} ↔ {pair.branchB}
                </code>
                <span style={{ color: tokens.muted }}>
                  {pair.count} shared file{pair.count === 1 ? "" : "s"}
                </span>
                <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {shown.join(", ")}
                  {more > 0 ? ` +${more} more` : ""}
                </code>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: 11.5, color: tokens.muted, whiteSpace: "nowrap" }}>
      <strong style={{ color: tokens.fg, fontWeight: 650 }}>{value}</strong> {label}
    </span>
  );
}

function WorktreeCard({
  card,
  now,
  onOpenDoc,
  focused = false,
  onCopyLink,
}: {
  card: WorktreeCardV1;
  now: number;
  onOpenDoc?: (card: WorktreeCardV1, relPath: string) => void;
  focused?: boolean;
  onCopyLink?: (card: WorktreeCardV1) => void;
}) {
  const tipAge = relativeTime(card.lastCommitAt, now);
  const firstDoc = (card.changedFiles ?? []).find((f) => DOC_FILE_RE.test(f)) ?? null;
  // Deep-link focus: scroll the named card into view (client-only; SSR renders
  // the ring without the effect).
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focused && ref.current && typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focused]);
  return (
    <article
      ref={ref}
      className="cos-fx-enter"
      data-focused={focused || undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        background: tokens.card,
        border: `1px solid ${focused ? tokens.accentBorder : tokens.border}`,
        boxShadow: focused ? `0 0 0 2px ${tokens.accentSoft}` : undefined,
        borderRadius: tokens.radius,
        minWidth: 0,
        transition: springTransition,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Pill label={card.origin} tone={ORIGIN_TONES[card.origin]} soft />
        <strong
          title={card.worktreeName ?? card.branch ?? card.cardKey}
          style={{ fontSize: 13.5, color: tokens.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}
        >
          {/* cardKey last resort: a schema-valid row with both identities null
              must still render SOMETHING addressable (lane B P2). */}
          {card.worktreeName ?? card.branch ?? card.cardKey}
        </strong>
        {onCopyLink && card.hasWorktree && card.worktreeName ? (
          <button
            type="button"
            onClick={() => onCopyLink(card)}
            aria-label={`Copy a durable link to ${card.worktreeName}`}
            title="Copy link to this worktree card"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 8px",
              borderRadius: tokens.radiusSm,
              background: tokens.secondary,
              border: `1px solid ${tokens.border}`,
              color: tokens.muted,
              font: "inherit",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: springTransition,
            }}
          >
            link
          </button>
        ) : null}
        {!card.hasWorktree ? <Pill label="no worktree" tone={tokens.muted} /> : null}
      </div>
      {card.branch && card.worktreeName ? (
        <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.branch}
        </code>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* The resolving intent-ladder rung — ALWAYS named (spec §8.6 / Fable major 6). */}
        <Pill label={card.rung} tone={card.laneSource === "work_record" ? tokens.accent : tokens.muted} soft title={`lane source: ${card.laneSource}`} />
        {card.dirtyFileCount !== null ? <Stat label="dirty" value={String(card.dirtyFileCount)} /> : null}
        {card.ahead !== null && card.behind !== null ? <Stat label="ahead/behind" value={`${card.ahead}/${card.behind}`} /> : null}
        {tipAge ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: tokens.muted }}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <ClockIcon size={11} />
            </span>
            {tipAge}
          </span>
        ) : null}
      </div>
      {card.ticketIds.length > 0 || card.checkpointCount > 0 || card.activeHandoff ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {card.ticketIds.map((t) => (
            <Pill key={t} label={t} tone={tokens.accent} soft />
          ))}
          {card.checkpointCount > 0 ? (
            <Pill
              label={`${card.checkpointCount} checkpoint${card.checkpointCount === 1 ? "" : "s"}${
                card.latestCheckpointAt ? ` · ${relativeTime(card.latestCheckpointAt, now) ?? ""}` : ""
              }`}
              tone={statusColors.proceed}
              soft
            />
          ) : null}
          {card.activeHandoff ? <Pill label="handoff pending" tone={statusColors.reviewUnknown} soft title={card.activeHandoff} /> : null}
        </div>
      ) : null}
      {card.docChangedCount > 0 && firstDoc ? (
        <button
          type="button"
          onClick={onOpenDoc ? () => onOpenDoc(card, firstDoc) : undefined}
          title={firstDoc}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 999,
            border: `1px solid ${tokens.accentBorder}`,
            background: tokens.accentSoft,
            color: tokens.accent,
            font: "inherit",
            fontSize: 11.5,
            fontWeight: 600,
            cursor: onOpenDoc ? "pointer" : "default",
            transition: springTransition,
          }}
        >
          {card.docChangedCount} doc{card.docChangedCount === 1 ? "" : "s"} updated
        </button>
      ) : null}
      {card.cleanupKind ? (
        <code
          style={{
            fontFamily: tokens.mono,
            fontSize: 11,
            color: tokens.muted,
            padding: "6px 8px",
            background: tokens.bg,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radiusSm,
            overflowX: "auto",
            whiteSpace: "nowrap",
          }}
        >
          {card.cleanupKind === "coh_promote"
            ? `coh promote   # from inside ${card.worktreeName ?? "the worktree"}`
            : `git worktree remove ${card.worktreeName ?? "<tree>"} && git branch -d ${card.branch ?? "<branch>"}`}
        </code>
      ) : null}
    </article>
  );
}
