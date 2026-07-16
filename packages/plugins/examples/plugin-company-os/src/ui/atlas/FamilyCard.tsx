/**
 * `FamilyCard` — the Atlas's primary card: one spec-prefix family. Collapsed, it
 * is a scannable summary (prefix + name + rolling/generic markers + repos +
 * lifecycle stepper + built bar) with NO ticket numbers; expanded (`<details>`,
 * keyboard-native), it reveals its builds (live chips, state-coloured spine),
 * its routed prefix-pure tickets, and its lineage tags. A zero-build family still
 * renders its card (Joe: show the 0, don't hide the state).
 *
 * Pure + SSR-faithful — the `<details>` expand is CSS-only (caret rotation via
 * `cockpit-motion`), so the Playwright harness screenshots an open card via
 * `defaultExpanded` with no hydration. Reuses the shared tokens / badges / chip
 * aesthetic (ported from the Board's `Chip`) — clean dividers, no card-in-card.
 */

import { useEffect, useRef, type CSSProperties } from "react";
import type { BuildV1, FamilyV1, TicketRefV1 } from "../../contracts/index.js";
import { columnAccent, statusColors, tokens } from "../tokens.js";
import { withAlpha } from "../shared/color.js";
import { Dot, Pill, RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { CaretIcon, ExternalLinkIcon } from "../icons.js";
import { LifecycleStepper } from "./LifecycleStepper.js";
import { familyDocChips, relativeTime } from "./atlas-view-model.js";

/** Compact human labels for the build's work-state (the chip's state tag). */
const STATE_LABELS: Record<BuildV1["state"], string> = {
  next_up: "Next up",
  in_progress: "In progress",
  in_review: "In review",
  shipped: "Shipped",
};

export function FamilyCard({
  family,
  now,
  defaultExpanded = false,
  focused = false,
}: {
  family: FamilyV1;
  now: number;
  defaultExpanded?: boolean;
  /** Deep-link focus (B1) — opens the card, scrolls it into view, accent ring. */
  focused?: boolean;
}) {
  // Same scroll idiom as the Branch·PR worktree cards (8f): client-only effect,
  // guarded so SSR/static render paths never touch it.
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (focused && ref.current && typeof ref.current.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [focused]);

  const activeBuilds = family.builds.filter((b) => b.state === "in_progress" || b.state === "in_review").length;
  const docChips = familyDocChips(family, now);
  const summaryAria =
    `${family.prefix} ${family.name} — ${family.builtSummary}` +
    (activeBuilds > 0 ? `, ${activeBuilds} in flight` : "") +
    (family.tickets.length > 0 ? `, ${family.tickets.length} ticket${family.tickets.length === 1 ? "" : "s"}` : "");

  return (
    <details
      ref={ref}
      className="cos-fx-card"
      open={defaultExpanded || focused}
      data-focused={focused || undefined}
      style={{
        background: tokens.card,
        border: `1px solid ${focused ? tokens.accentBorder : tokens.border}`,
        boxShadow: focused ? `0 0 0 2px ${withAlpha(tokens.accent, 0.18)}` : undefined,
        borderRadius: tokens.radius,
        overflow: "hidden",
      }}
    >
      <summary
        className="cos-fx-summary"
        aria-label={summaryAria}
        style={{ cursor: "pointer", listStyle: "none", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}
      >
        {/* Identity row — prefix, name, markers, repos, caret. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: tokens.mono, fontSize: 13, fontWeight: 700, color: tokens.fg, letterSpacing: 0.3, flex: "0 0 auto" }}>
            {family.prefix}
          </span>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: tokens.fg,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {family.name}
          </span>
          {family.isGeneric ? <GenericMarker /> : null}
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {family.repos.map((repo) => (
              <RepoBadge key={repo} repo={repo} />
            ))}
          </span>
          <span aria-hidden="true" className="cos-fx-caret" style={{ display: "inline-flex", color: tokens.muted, flex: "0 0 auto" }}>
            <CaretIcon size={15} />
          </span>
        </div>

        {/* C2: the spec's one-line description — the card answers "what IS this
            family" without expanding (falls back silently when the doc has none). */}
        {family.description ? (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: tokens.muted,
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
            }}
          >
            {family.description}
          </p>
        ) : null}

        {/* Status row — lifecycle stepper + built bar. */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <LifecycleStepper lifecycle={family.lifecycle} isRolling={family.isRolling} size="compact" />
          <span style={{ flex: 1, minWidth: 120 }}>
            <BuiltBar family={family} />
          </span>
        </div>

        {/* C2: doc-health chips — spec staleness + the shipped-build-vs-active-plan
            lag (the "docs must move with the build" ruling). Absent when clean. */}
        {docChips.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {docChips.map((chip) => (
              <Pill key={chip.kind} label={chip.label} tone={statusColors.revise} soft withDot />
            ))}
          </div>
        ) : null}
      </summary>

      {/* Expanded body — builds, tickets, lineage. */}
      <div className="cos-fx-drawer-body" style={{ borderTop: `1px solid ${tokens.border}`, padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <BuildsSection builds={family.builds} homeRepo={family.repos[0] ?? null} now={now} />
        {family.tickets.length > 0 ? <TicketsSection tickets={family.tickets} /> : null}
        {family.lineageTags.length > 0 ? <LineageTags tags={family.lineageTags} /> : null}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Built bar
// ---------------------------------------------------------------------------

function BuiltBar({ family }: { family: FamilyV1 }) {
  const rolling = family.isRolling;
  const pct = Math.max(0, Math.min(100, family.builtPct));
  const fillTone = rolling ? statusColors.live : statusColors.ship;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }} aria-label={`Built — ${family.builtSummary}`}>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          height: 6,
          borderRadius: 999,
          background: tokens.secondary,
          border: `1px solid ${tokens.border}`,
          overflow: "hidden",
        }}
      >
        <span
          className={rolling ? "cos-fx-flow" : undefined}
          style={{
            display: "block",
            height: "100%",
            width: rolling ? "100%" : `${pct}%`,
            background: rolling
              ? `repeating-linear-gradient(90deg, ${withAlpha(fillTone, 0.5)} 0 8px, ${withAlpha(fillTone, 0.28)} 8px 16px)`
              : withAlpha(fillTone, 0.85),
          }}
        />
      </span>
      <span style={{ fontSize: 10.5, color: tokens.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {family.builtSummary}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Builds — the family's live chips (state-coloured spine)
// ---------------------------------------------------------------------------

function BuildsSection({ builds, homeRepo, now }: { builds: readonly BuildV1[]; homeRepo: string | null; now: number }) {
  if (builds.length === 0) {
    return <CalmNote>No builds yet — this family is registered and fills in as branches, PRs, and merges land.</CalmNote>;
  }
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SubHeading text="Builds" note={`${builds.length}`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
        {builds.map((build) => (
          <BuildChip key={build.ticketId} build={build} homeRepo={homeRepo} now={now} />
        ))}
      </div>
    </section>
  );
}

/** One build — the ported Board chip: state spine + id + repo + PR# + link + moved-at. */
function BuildChip({ build, homeRepo, now }: { build: BuildV1; homeRepo: string | null; now: number }) {
  const crossRepo = homeRepo !== null && build.repo !== homeRepo;
  const moved = relativeTime(build.updatedAt, now);
  const isLink = build.url !== null && build.url !== "";
  const ariaLabel = [
    build.ticketId,
    build.title ?? "",
    STATE_LABELS[build.state],
    crossRepo ? `in ${build.repo}` : "",
    build.prNumber !== null ? `PR ${build.prNumber}` : "",
    moved ? `updated ${moved}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const inner = (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: tokens.mono, fontSize: 12, fontWeight: 700, color: tokens.fg, letterSpacing: 0.2 }}>{build.ticketId}</span>
        {crossRepo ? <RepoBadge repo={build.repo} /> : null}
        {build.prNumber !== null ? <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted }}>#{build.prNumber}</span> : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.2, color: columnAccent[build.state], whiteSpace: "nowrap" }}>
          {STATE_LABELS[build.state]}
        </span>
        {isLink ? (
          <span aria-hidden="true" style={{ color: tokens.muted, display: "inline-flex" }}>
            <ExternalLinkIcon size={12} />
          </span>
        ) : null}
      </span>
      {build.title ? (
        <span
          style={
            {
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.35,
              color: tokens.fg,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            } as CSSProperties
          }
        >
          {build.title}
        </span>
      ) : null}
    </>
  );

  const style: CSSProperties = {
    display: "block",
    textDecoration: "none",
    color: tokens.fg,
    background: tokens.cardElevated,
    border: `1px solid ${tokens.border}`,
    borderLeft: `3px solid ${columnAccent[build.state]}`,
    borderRadius: tokens.radiusSm,
    padding: "7px 9px",
    minWidth: 0,
  };

  if (isLink) {
    return (
      <a
        className="cos-chip-hover"
        href={build.url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        style={{ ...style, cursor: "pointer" }}
        aria-label={`${ariaLabel} — open link`}
        title={build.title ?? build.ticketId}
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="cos-chip-hover" role="group" tabIndex={0} style={style} aria-label={ariaLabel} title={build.title ?? build.ticketId}>
      {inner}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routed tickets (prefix-pure) + lineage tags
// ---------------------------------------------------------------------------

function TicketsSection({ tickets }: { tickets: readonly TicketRefV1[] }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SubHeading text="Tickets" note={`${tickets.length}`} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {tickets.map((ticket) => (
          <li
            key={ticket.identifier}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 9px",
              background: tokens.bg,
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radiusSm,
              minWidth: 0,
            }}
          >
            <span style={{ fontFamily: tokens.mono, fontSize: 11.5, fontWeight: 600, color: tokens.muted, flex: "0 0 auto" }}>{ticket.identifier}</span>
            <span style={{ fontSize: 12.5, color: tokens.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
              {ticket.title ?? "—"}
            </span>
            {ticket.priority ? <Pill label={ticket.priority} tone={tokens.muted} /> : null}
            {ticket.status ? <Pill label={ticket.status} tone={statusColors.proceed} soft /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LineageTags({ tags }: { tags: readonly string[] }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SubHeading text="Related" note={`${tags.length}`} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tags.map((tag) => (
          <Pill key={tag} label={tag} tone={tokens.muted} icon={<Dot tone={statusColors.proceed} size={6} />} title={`Lineage link to ${tag}`} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function GenericMarker() {
  return (
    <span
      aria-label="generic prefix — anti-pattern; prefer a specific family"
      title="generic prefix — anti-pattern; prefer a specific family"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0 6px",
        height: 16,
        borderRadius: 4,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: statusColors.generic,
        background: withAlpha(statusColors.generic, 0.14),
        border: `1px solid ${withAlpha(statusColors.generic, 0.42)}`,
        flex: "0 0 auto",
      }}
    >
      generic
    </span>
  );
}

function SubHeading({ text, note }: { text: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: tokens.muted }}>{text}</span>
      {note ? <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{note}</span> : null}
    </div>
  );
}
