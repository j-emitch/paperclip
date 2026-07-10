/**
 * `RecentlyLandedLane` — the per-repo "what shipped this week" band (COS-8b).
 * Renders the repo's `landedPullRequests` (already window-filtered to
 * `LANDED_WINDOW_DAYS` and newest-first by the projection): each row is the PR
 * as a real `<a>` (mirroring `PrDetailRow`), its ticket chips, HOW it landed,
 * and a relative landed time.
 *
 * `via` is rendered honestly: `merged` = a real GitHub merge (ship tone);
 * `closed` = the PR left the open state without a recorded merge — on this
 * workspace usually the JB ship-to-prod ff-push (work landed, PR closed), but
 * possibly abandoned, so the chip says "closed" and never claims "merged".
 * Empty is shown as a one-line muted count, not hidden (show-0 rule).
 * Pure + SSR-faithful; no SDK runtime.
 */

import type { LandedPrV1 } from "../../contracts/index.js";
import type { PrLandedVia } from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { ExternalLinkIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";

/** UI copy for the lane window — keep in step with `LANDED_WINDOW_DAYS` (contract const). */
const LANDED_WINDOW_LABEL = "7d";

/**
 * UI-local via label/tone maps (the import boundary forbids VALUE imports from
 * contracts; the `Record<PrLandedVia, …>` keys keep them compile-drift-guarded).
 */
const VIA_LABELS: Record<PrLandedVia, string> = { merged: "merged", closed: "closed" };
const VIA_TONES: Record<PrLandedVia, string> = { merged: statusColors.ship, closed: tokens.muted };
const VIA_TITLES: Record<PrLandedVia, string> = {
  merged: "GitHub recorded a merge for this PR",
  closed: "the PR left the open state without a recorded merge — landed via ff-push, or abandoned",
};

function LandedRow({ pr, now }: { pr: LandedPrV1; now: number }) {
  const landed = relativeTime(pr.landedAt, now);
  const title = pr.title ?? pr.headRef ?? `PR #${pr.prNumber}`;
  const isLink = pr.url !== null && pr.url !== "";

  const heading = (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, minWidth: 0 }}>
      <span style={{ fontFamily: tokens.mono, fontSize: 11.5, fontWeight: 700, color: tokens.accent, flex: "0 0 auto" }}>
        #{pr.prNumber}
      </span>
      <span style={{ fontSize: 12.5, color: tokens.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </span>
      {isLink ? (
        <span aria-hidden="true" style={{ display: "inline-flex", color: tokens.muted, flex: "0 0 auto" }}>
          <ExternalLinkIcon size={11} />
        </span>
      ) : null}
    </span>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, padding: "4px 2px" }}>
      {isLink ? (
        <a
          href={pr.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="cos-fx-row"
          style={{ textDecoration: "none", minWidth: 0, borderRadius: tokens.radiusSm }}
          title={`Open PR #${pr.prNumber} on GitHub`}
        >
          {heading}
        </a>
      ) : (
        heading
      )}
      <Pill label={VIA_LABELS[pr.via]} tone={VIA_TONES[pr.via]} soft={pr.via !== "merged"} withDot={pr.via === "merged"} title={VIA_TITLES[pr.via]} />
      {pr.ticketIds.length > 0 ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {pr.ticketIds.map((t) => (
            <Pill key={t} label={t} tone={tokens.muted} />
          ))}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {landed ? (
        <span style={{ fontSize: 11, color: tokens.muted }} title={`landed ${pr.landedAt}`}>
          {landed}
        </span>
      ) : null}
    </div>
  );
}

/** The lane: an uppercase header with the window + count, then one row per landed PR. */
export function RecentlyLandedLane({ landed, now }: { landed: readonly LandedPrV1[]; now: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tokens.muted }}>
          Recently landed ({LANDED_WINDOW_LABEL})
        </span>
        <span style={{ fontSize: 11, color: tokens.muted }}>· {landed.length}</span>
      </div>
      {landed.length === 0 ? (
        <span style={{ fontSize: 11.5, color: tokens.muted, paddingLeft: 2 }}>none in the last {LANDED_WINDOW_LABEL}</span>
      ) : (
        landed.map((pr) => <LandedRow key={pr.prNumber} pr={pr} now={now} />)
      )}
    </div>
  );
}
