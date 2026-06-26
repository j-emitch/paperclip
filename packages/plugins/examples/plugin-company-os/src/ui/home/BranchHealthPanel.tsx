/**
 * `BranchHealthPanel` — the alert-worthy branch rows (spec §5.3/§7), grouped by
 * project family via the shared `<ProjectSection>`. Worst-severity-first within a
 * family; each row carries a color dot AND a severity label (never color alone),
 * the derived status flags, behind/stale magnitudes, and a deep-link to the
 * Source tab. Home shows only families that HAVE at-risk branches plus a single
 * calm 0-state when everything is healthy. Pure — `Home` follows the deep-link.
 */

import type { BranchHealthEntryV1, DeepLink, ProjectTaxonomyV1 } from "../../contracts/index.js";
import { tokens, statusColors } from "../tokens.js";
import { Dot, Pill, RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ProjectSection } from "../shared/ProjectSection.js";
import {
  BRANCH_STATUS_LABELS,
  HEALTH_SEVERITY_LABELS,
  HEALTH_SEVERITY_TONES,
  groupByProject,
  sortByHealth,
} from "./home-view-model.js";

const MAX_STATUS_CHIPS = 3;

export interface BranchHealthPanelProps {
  branchHealth: readonly BranchHealthEntryV1[];
  taxonomy: ProjectTaxonomyV1;
  isMobile?: boolean;
  onFollow?: (link: DeepLink) => void;
}

export function BranchHealthPanel({ branchHealth, taxonomy, isMobile = false, onFollow }: BranchHealthPanelProps) {
  const grouped = groupByProject(taxonomy, branchHealth);
  if (grouped.length === 0) {
    return <CalmNote tone={statusColors.ship}>All branches healthy — nothing needs attention.</CalmNote>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {grouped.map(({ group, items }) => (
        <ProjectSection key={group.key} group={group} count={items.length} compact>
          {sortByHealth(items).map((entry, i) => (
            <BranchHealthRow key={`${entry.repo}:${entry.branch ?? `_detached:${i}`}`} entry={entry} isMobile={isMobile} onFollow={onFollow} />
          ))}
        </ProjectSection>
      ))}
    </div>
  );
}

function BranchHealthRow({ entry, isMobile, onFollow }: { entry: BranchHealthEntryV1; isMobile: boolean; onFollow?: (link: DeepLink) => void }) {
  const tone = HEALTH_SEVERITY_TONES[entry.severity];
  const chips = entry.statuses.slice(0, MAX_STATUS_CHIPS);
  const overflow = entry.statuses.length - chips.length;
  const magnitudes: string[] = [];
  if (entry.behind !== null && entry.behind > 0) magnitudes.push(`${entry.behind} behind`);
  if (entry.staleDays > 0) magnitudes.push(`${entry.staleDays}d stale`);

  const branchCode = (
    <code
      title={entry.branch ?? "detached HEAD"}
      style={{
        fontFamily: tokens.mono,
        fontSize: 12,
        color: tokens.fg,
        fontWeight: 600,
        flex: isMobile ? 1 : "0 1 auto",
        minWidth: 0,
        maxWidth: isMobile ? "none" : 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {entry.branch ?? "detached"}
    </code>
  );
  const statusChips = (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", minWidth: 0 }}>
      {chips.map((status) => (
        <Pill key={status} label={BRANCH_STATUS_LABELS[status]} tone={tokens.muted} />
      ))}
      {overflow > 0 ? <span style={{ fontSize: 11, color: tokens.muted }}>+{overflow}</span> : null}
    </div>
  );
  const magnitudeText =
    magnitudes.length > 0 ? (
      <span style={{ fontSize: 11.5, color: tokens.muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {magnitudes.join(" · ")}
      </span>
    ) : null;
  const severityPill = <Pill label={HEALTH_SEVERITY_LABELS[entry.severity]} tone={tone} soft />;
  const goArrow = (
    <span aria-hidden="true" className="cos-fx-row-go" style={{ color: tone, fontSize: 15, lineHeight: 1, flex: "0 0 auto" }}>
      →
    </span>
  );

  const baseStyle = {
    padding: isMobile ? "10px 12px" : "9px 11px",
    textAlign: "left" as const,
    width: "100%",
    minWidth: 0,
    background: tokens.card,
    border: `1px solid ${tokens.border}`,
    borderLeft: `3px solid ${tone}`,
    borderRadius: tokens.radiusSm,
    color: tokens.fg,
    font: "inherit",
    cursor: onFollow ? "pointer" : "default",
  };
  const onClick = onFollow ? () => onFollow(entry.deepLink) : undefined;
  const title = `Open ${entry.repo} · ${entry.branch ?? "detached"} in Source`;

  // Mobile: a two-line stack so the branch name + chips + magnitudes never collide.
  if (isMobile) {
    return (
      <button type="button" className="cos-fx-row" onClick={onClick} title={title} style={{ ...baseStyle, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Dot tone={tone} />
          {branchCode}
          {severityPill}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <RepoBadge repo={entry.repo} />
          {statusChips}
          {magnitudeText ? (
            <>
              <span style={{ flex: 1 }} />
              {magnitudeText}
            </>
          ) : null}
        </div>
      </button>
    );
  }

  return (
    <button type="button" className="cos-fx-row" onClick={onClick} title={title} style={{ ...baseStyle, display: "flex", alignItems: "center", gap: 10 }}>
      <Dot tone={tone} />
      {branchCode}
      <RepoBadge repo={entry.repo} />
      {statusChips}
      <span style={{ flex: 1 }} />
      {magnitudeText}
      {severityPill}
      {goArrow}
    </button>
  );
}
