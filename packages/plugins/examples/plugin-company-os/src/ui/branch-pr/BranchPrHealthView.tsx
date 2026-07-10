/**
 * `BranchPrHealthView` — the pure Branch · PR Health surface (spec §5.1/§5.7, COS-5e):
 * the dedicated home for branch + worktree + PR health that the Source tab grew into.
 * It leads with a vitals masthead + a "needs attention" band (the branch-health digest
 * RELOCATED off Home, worst-first) + a review-flagged-PR callout, then the full
 * per-branch audit PROJECT-GROUPED via `<ProjectSection>`: each project lists its
 * member repos primary-first (incl. configured-but-absent 0-rows), each available repo
 * lists its branches (most-recently-active first) as expandable `BranchRow`s carrying
 * their open-PR lifecycle + review state, plus any orphan PRs (open PRs with no local
 * branch). No SDK runtime — the connected `BranchPrHealth` injects data, so this renders
 * identically under SSR (the Playwright harness) and live.
 */

import type { ReactNode } from "react";
import type { BranchGitV1, BranchPrV1, GitStateV1, ProjectGitSectionV1, RepoGitStateV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot, Pill, RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { ProjectSection } from "../shared/ProjectSection.js";
import { StaleSourcePills, SurfaceFreshnessBadge } from "../shared/freshness.js";
import { safeTime } from "../shared/time.js";
import {
  HEALTH_SEVERITY_LABELS,
  HEALTH_SEVERITY_TONES,
  REPO_AVAILABILITY_LABELS,
  REPO_AVAILABILITY_TONES,
} from "../shared/git-labels.js";
import { BranchRow } from "./BranchRow.js";
import { PrChip, PrDetailRow } from "./PrChip.js";
import { RecentlyLandedLane } from "./RecentlyLandedLane.js";
import { type AttentionRow, type FlaggedReviewRow, buildBranchPrView } from "./branch-pr-view-model.js";

export interface BranchPrHealthViewProps {
  gitState: GitStateV1;
  now: number;
  isMobile?: boolean;
  /** A `branchExpandKey(repoKey, branch)` to auto-expand (a consumed deep-link / band click). */
  expandKey?: string | null;
  /** Focus (open + scroll to) a branch row — wired by the attention band + review callout. */
  onFocusBranch?: (repoKey: string, branch: string | null) => void;
}

/** The stable key used to match a deep-link / band click's target branch to its row. */
export function branchExpandKey(repoKey: string, branch: string | null): string {
  return `${repoKey}::${branch ?? "_detached"}`;
}

function branchCount(section: ProjectGitSectionV1): number {
  return section.repos.reduce((sum, r) => sum + r.branches.length, 0);
}

/** A mono branch-ref style with ellipsis truncation (the full ref lives in a `title`). */
function branchRefStyle(color: string) {
  return {
    fontFamily: tokens.mono,
    fontSize: 11.5,
    fontWeight: 600 as const,
    color,
    display: "inline-block" as const,
    maxWidth: 260,
    minWidth: 0,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    whiteSpace: "nowrap" as const,
    verticalAlign: "bottom" as const,
  };
}

/** A staggered entrance wrapper — the surface settles in top-to-bottom (reduced-motion-gated). */
function Reveal({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="cos-fx-enter" style={{ animationDelay: `${index * 60}ms` }}>
      {children}
    </div>
  );
}

export function BranchPrHealthView({ gitState, now, isMobile = false, expandKey = null, onFocusBranch }: BranchPrHealthViewProps) {
  const hasAnyRepo = gitState.groups.some((g) => g.repos.length > 0);
  const view = buildBranchPrView(gitState);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Branch · PR Health</h2>
        <SurfaceFreshnessBadge noun="Branch · PR" derivedAt={gitState.derivedAt} sources={gitState.sources} now={now} />
        <StaleSourcePills sources={gitState.sources} />
      </header>

      {hasAnyRepo ? (
        <Reveal index={0}>
          <VitalsBar vitals={view.vitals} />
        </Reveal>
      ) : null}

      {view.attention.length > 0 ? (
        <Reveal index={1}>
          <AttentionBand rows={view.attention} isMobile={isMobile} onFocusBranch={onFocusBranch} />
        </Reveal>
      ) : null}

      {view.flaggedReviews.length > 0 ? (
        <Reveal index={2}>
          <FlaggedReviewsCallout rows={view.flaggedReviews} now={now} onFocusBranch={onFocusBranch} />
        </Reveal>
      ) : null}

      {!hasAnyRepo ? (
        <CalmNote>No repositories are configured yet — add roots to <code style={{ fontFamily: tokens.mono }}>repoRoots</code> and they appear here on the next derive.</CalmNote>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {gitState.groups.map((section, i) => (
            <div key={section.group.key} className="cos-fx-enter" style={{ animationDelay: `${(i + 3) * 60}ms` }}>
              <ProjectSection group={section.group} count={branchCount(section)}>
                {section.repos.length === 0 ? (
                  <CalmNote>No repositories in this project.</CalmNote>
                ) : (
                  section.repos.map((repo) => (
                    <RepoSection
                      key={repo.repoKey}
                      repo={repo}
                      isDisplayPrimary={section.displayPrimaryRepoKey === repo.repoKey}
                      now={now}
                      isMobile={isMobile}
                      expandKey={expandKey}
                    />
                  ))
                )}
              </ProjectSection>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masthead vitals
// ---------------------------------------------------------------------------

function VitalTile({ label, value, tone, title }: { label: string; value: number; tone?: string; title?: string }) {
  return (
    <div
      title={title}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "8px 12px",
        minWidth: 74,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusSm,
        background: tokens.card,
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 700, color: tone ?? tokens.fg, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: tokens.muted }}>{label}</span>
    </div>
  );
}

function VitalsBar({ vitals }: { vitals: ReturnType<typeof buildBranchPrView>["vitals"] }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <VitalTile label="repos" value={vitals.repoCount} title="repositories present on disk" />
      <VitalTile label="branches" value={vitals.branchCount} />
      <VitalTile label="open PRs" value={vitals.openPrCount} />
      <VitalTile
        label="reviewed"
        value={vitals.reviewedPrCount}
        tone={vitals.reviewedPrCount > 0 ? statusColors.ship : undefined}
        title="open PRs with a review of their current head"
      />
      <VitalTile
        label="need attention"
        value={vitals.needsAttentionCount}
        tone={vitals.needsAttentionCount > 0 ? statusColors.stale : statusColors.ship}
        title="branches flagged by git-status severity (matches Home)"
      />
      <VitalTile
        label="orphan PRs"
        value={vitals.orphanPrCount}
        tone={vitals.orphanPrCount > 0 ? statusColors.cached : undefined}
        title="open PRs whose head branch is not checked out locally"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attention band (relocated Home branch-health digest, worst-first)
// ---------------------------------------------------------------------------

function AttentionBand({
  rows,
  isMobile,
  onFocusBranch,
}: {
  rows: readonly AttentionRow[];
  isMobile: boolean;
  onFocusBranch?: (repoKey: string, branch: string | null) => void;
}) {
  return (
    <section
      aria-label="Branches needing attention"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 13px",
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${statusColors.stale}`,
        borderRadius: tokens.radius,
        background: tokens.card,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 650, color: tokens.fg }}>
        <Dot tone={statusColors.stale} size={7} />
        Needs attention <span style={{ color: tokens.muted, fontWeight: 500 }}>· {rows.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row, i) => (
          <AttentionRowView key={`${row.repoKey}:${row.branch ?? `_detached:${i}`}`} row={row} isMobile={isMobile} onFocusBranch={onFocusBranch} />
        ))}
      </div>
    </section>
  );
}

function AttentionRowView({
  row,
  isMobile,
  onFocusBranch,
}: {
  row: AttentionRow;
  isMobile: boolean;
  onFocusBranch?: (repoKey: string, branch: string | null) => void;
}) {
  const tone = HEALTH_SEVERITY_TONES[row.severity];
  const magnitudes: string[] = [];
  if (row.behind !== null && row.behind > 0) magnitudes.push(`${row.behind} behind`);
  if (row.staleDays > 0) magnitudes.push(`${row.staleDays}d stale`);
  // Focusable/openable whenever a handler exists — detached rows included, since
  // branchExpandKey() supports a null branch (codex P2). Non-clickable rows render as a
  // plain <div>, never a dead focusable <button>.
  const clickable = onFocusBranch !== undefined;

  const branchCode = (
    <code
      title={row.branch ?? "detached HEAD"}
      style={{
        fontFamily: tokens.mono,
        fontSize: 12,
        color: tokens.fg,
        fontWeight: 600,
        flex: isMobile ? 1 : "0 1 auto",
        minWidth: 0,
        maxWidth: isMobile ? "none" : 240,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {row.branch ?? "detached"}
    </code>
  );
  const severityPill = <Pill label={HEALTH_SEVERITY_LABELS[row.severity]} tone={tone} soft />;
  const prPill =
    row.prNumber !== null ? (
      <span style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted }} title={`open PR #${row.prNumber}`}>
        #{row.prNumber}
      </span>
    ) : null;
  const magnitudeText =
    magnitudes.length > 0 ? (
      <span style={{ fontSize: 11.5, color: tokens.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{magnitudes.join(" · ")}</span>
    ) : null;

  const baseStyle = {
    padding: isMobile ? "9px 11px" : "8px 10px",
    textAlign: "left" as const,
    width: "100%",
    minWidth: 0,
    background: tokens.bg,
    border: `1px solid ${tokens.border}`,
    borderLeft: `3px solid ${tone}`,
    borderRadius: tokens.radiusSm,
    color: tokens.fg,
    font: "inherit",
    cursor: clickable ? "pointer" : "default",
  };
  const onClick = clickable ? () => onFocusBranch?.(row.repoKey, row.branch) : undefined;
  const title = clickable ? `Jump to ${row.repoKey} · ${row.branch ?? "detached"} below` : undefined;

  const inner = isMobile ? (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
        <Dot tone={tone} />
        {branchCode}
        {severityPill}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0, width: "100%" }}>
        <RepoBadge repo={row.repoKey} />
        {prPill}
        {magnitudeText ? (
          <>
            <span style={{ flex: 1 }} />
            {magnitudeText}
          </>
        ) : null}
      </div>
    </>
  ) : (
    <>
      <Dot tone={tone} />
      {branchCode}
      <RepoBadge repo={row.repoKey} />
      {prPill}
      <span style={{ flex: 1 }} />
      {magnitudeText}
      {severityPill}
      {clickable ? (
        <span aria-hidden="true" className="cos-fx-row-go" style={{ color: tone, fontSize: 15, lineHeight: 1, flex: "0 0 auto" }}>
          →
        </span>
      ) : null}
    </>
  );

  const layoutStyle = {
    ...baseStyle,
    display: "flex",
    flexDirection: isMobile ? ("column" as const) : ("row" as const),
    alignItems: isMobile ? ("stretch" as const) : ("center" as const),
    gap: isMobile ? 7 : 10,
  };
  // A clickable row is a real <button> (keyboard-focusable); a non-interactive row (no
  // handler wired, e.g. the SSR harness) is a plain <div> so it's never a dead tab-stop.
  return clickable ? (
    <button type="button" className="cos-fx-row" onClick={onClick} title={title} style={layoutStyle}>
      {inner}
    </button>
  ) : (
    <div style={layoutStyle}>{inner}</div>
  );
}

// ---------------------------------------------------------------------------
// Review-flagged PRs (the second health axis — blocking/revise verdicts)
// ---------------------------------------------------------------------------

function FlaggedReviewsCallout({
  rows,
  now,
  onFocusBranch,
}: {
  rows: readonly FlaggedReviewRow[];
  now: number;
  onFocusBranch?: (repoKey: string, branch: string | null) => void;
}) {
  return (
    <section
      aria-label="PRs flagged by review"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 13px",
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${statusColors.danger}`,
        borderRadius: tokens.radius,
        background: tokens.card,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 650, color: tokens.fg }}>
        <Dot tone={statusColors.danger} size={7} />
        Flagged by review <span style={{ color: tokens.muted, fontWeight: 500 }}>· {rows.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <div key={`${row.repoKey}:${row.pr.prNumber}`} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <RepoBadge repo={row.repoKey} />
              {row.branch !== null && onFocusBranch ? (
                <button
                  type="button"
                  className="cos-fx-row"
                  onClick={() => onFocusBranch(row.repoKey, row.branch)}
                  title={`Jump to ${row.repoKey} · ${row.branch} below`}
                  style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", minWidth: 0, maxWidth: "100%", overflow: "hidden" }}
                >
                  <code style={branchRefStyle(tokens.accent)}>{row.branch}</code>
                </button>
              ) : (
                <code title={row.branch ?? undefined} style={branchRefStyle(tokens.muted)}>
                  {row.branch ?? "no local branch"}
                </code>
              )}
            </div>
            <PrDetailRow pr={row.pr} now={now} showHeadRef={row.branch === null} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The full per-branch audit tree
// ---------------------------------------------------------------------------

function RepoSection({
  repo,
  isDisplayPrimary,
  now,
  isMobile,
  expandKey,
}: {
  repo: RepoGitStateV1;
  isDisplayPrimary: boolean;
  now: number;
  isMobile: boolean;
  expandKey: string | null;
}) {
  const available = repo.availability === "ok";
  // Most-recently-active branches first; unknown/unparseable tip dates sort last.
  const branches = [...repo.branches].sort((a, b) => safeTime(b.lastCommitAt) - safeTime(a.lastCommitAt));

  return (
    <section aria-label={repo.repoKey} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        <RepoBadge repo={repo.repoKey} />
        {repo.role === "dependency" ? <Pill label="dependency" tone={tokens.muted} /> : null}
        {isDisplayPrimary ? <Pill label="acting primary" tone={statusColors.cached} title="the configured primary repo is absent on disk; this dependency is shown as the project's primary" /> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: REPO_AVAILABILITY_TONES[repo.availability] }}>
          <Dot tone={REPO_AVAILABILITY_TONES[repo.availability]} size={6} />
          {REPO_AVAILABILITY_LABELS[repo.availability]}
        </span>
        {available && repo.trunk.ref ? (
          <span style={{ fontSize: 11, color: tokens.muted, fontFamily: tokens.mono }} title="trunk this repo's branches compare against">
            trunk: {repo.trunk.ref}
          </span>
        ) : null}
        {available && repo.trunk.state === "missing" ? (
          <span style={{ fontSize: 11, color: statusColors.cached }}>no trunk resolved</span>
        ) : null}
        <ConflictCoverage branches={branches} />
      </div>

      {!available ? (
        <CalmNote>This repo is configured but {REPO_AVAILABILITY_LABELS[repo.availability]} — nothing to show until it&rsquo;s present.</CalmNote>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {branches.length === 0 && repo.orphanPullRequests.length === 0 ? (
            <CalmNote tone={statusColors.ship}>No branches — clean working copy.</CalmNote>
          ) : (
            <>
              {branches.map((branch) => (
                <BranchRow
                  key={branch.branch ?? `_detached:${branch.headSha}`}
                  branch={branch}
                  now={now}
                  isMobile={isMobile}
                  defaultExpanded={expandKey === branchExpandKey(repo.repoKey, branch.branch)}
                />
              ))}
              {repo.orphanPullRequests.length > 0 ? (
                <OrphanPrs prs={repo.orphanPullRequests} now={now} />
              ) : null}
            </>
          )}
          {/* COS-8b: what shipped this week — rendered for every available repo (show-0). */}
          <RecentlyLandedLane landed={repo.landedPullRequests} now={now} />
        </div>
      )}
    </section>
  );
}

/**
 * COS-8e/K7: conflict-prediction coverage — evaluated / eligible (ahead AND
 * behind) branches. A budget-capped scan must not read as calm: under-100%
 * renders in the cached (amber) tone. Hidden only when NOTHING is eligible.
 */
function ConflictCoverage({ branches }: { branches: readonly BranchGitV1[] }) {
  const eligible = branches.filter((b) => b.comparison === "ok" && (b.ahead ?? 0) > 0 && (b.behind ?? 0) > 0);
  if (eligible.length === 0) return null;
  const covered = eligible.filter((b) => b.conflictsWithTrunk !== null).length;
  const pct = Math.round((covered / eligible.length) * 100);
  const full = covered === eligible.length;
  return (
    <span
      style={{ fontSize: 11, color: full ? tokens.muted : statusColors.cached }}
      title={`conflict prediction evaluated ${covered} of ${eligible.length} ahead-and-behind branches this derive (cost-capped; dirty + recently-active first)`}
    >
      conflict prediction {covered}/{eligible.length} ({pct}%)
    </span>
  );
}

/** Open PRs with no matching local branch — surfaced honestly, never dropped. */
function OrphanPrs({ prs, now }: { prs: readonly BranchPrV1[]; now: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: tokens.muted }}>
          PRs without a local branch
        </span>
        <span style={{ fontSize: 11, color: tokens.muted }}>· {prs.length}</span>
      </div>
      {prs.map((pr) => (
        <PrDetailRow key={pr.prNumber} pr={pr} now={now} showHeadRef />
      ))}
    </div>
  );
}
