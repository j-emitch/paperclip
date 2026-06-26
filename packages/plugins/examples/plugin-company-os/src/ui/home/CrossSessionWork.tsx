/**
 * `CrossSessionWork` — the "what's moving across my projects" glance (spec §5.3):
 * recent specs / plans / PRs / tickets from other sessions, grouped by project
 * family via the shared `<ProjectSection>`, newest-first within each family. Each
 * row carries a kind badge, the title, its system + status, how recently it
 * moved, and a deep-link to the Board or Docs. Pure — `Home` follows the link.
 */

import type { DeepLink, ProjectTaxonomyV1, RecentWorkV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ProjectSection } from "../shared/ProjectSection.js";
import { relativeTime } from "../shared/time.js";
import { RECENT_WORK_KIND_LABELS, RECENT_WORK_KIND_TONES, groupByProject } from "./home-view-model.js";

export interface CrossSessionWorkProps {
  recentWork: readonly RecentWorkV1[];
  taxonomy: ProjectTaxonomyV1;
  now: number;
  isMobile?: boolean;
  onFollow?: (link: DeepLink) => void;
}

export function CrossSessionWork({ recentWork, taxonomy, now, isMobile = false, onFollow }: CrossSessionWorkProps) {
  const grouped = groupByProject(taxonomy, recentWork);
  if (grouped.length === 0) {
    return <CalmNote>No cross-session work has moved recently.</CalmNote>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {grouped.map(({ group, items }) => (
        <ProjectSection key={group.key} group={group} count={items.length} compact>
          {[...items]
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .map((item, i) => (
              <WorkRow key={`${item.kind}:${item.title}:${i}`} item={item} now={now} isMobile={isMobile} onFollow={onFollow} />
            ))}
        </ProjectSection>
      ))}
    </div>
  );
}

function WorkRow({ item, now, isMobile, onFollow }: { item: RecentWorkV1; now: number; isMobile: boolean; onFollow?: (link: DeepLink) => void }) {
  const tone = RECENT_WORK_KIND_TONES[item.kind];
  const age = relativeTime(item.updatedAt, now);

  const kindPill = <Pill label={RECENT_WORK_KIND_LABELS[item.kind]} tone={tone} soft />;
  const titleText = (
    <span
      style={{
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        fontWeight: 550,
        color: tokens.fg,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {item.title}
    </span>
  );
  const meta = (
    <>
      {item.status ? <Pill label={item.status} tone={tokens.muted} /> : null}
      <span style={{ fontSize: 11, color: tokens.muted, fontFamily: tokens.mono, whiteSpace: "nowrap" }}>{item.system}</span>
      {age ? (
        <span style={{ fontSize: 11.5, color: tokens.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{age}</span>
      ) : null}
    </>
  );

  const baseStyle = {
    padding: isMobile ? "10px 12px" : "9px 11px",
    textAlign: "left" as const,
    width: "100%",
    minWidth: 0,
    background: tokens.card,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.fg,
    font: "inherit",
    cursor: onFollow ? "pointer" : "default",
  };
  const onClick = onFollow ? () => onFollow(item.deepLink) : undefined;

  if (isMobile) {
    return (
      <button type="button" className="cos-fx-row" onClick={onClick} title={item.title} style={{ ...baseStyle, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {kindPill}
          {titleText}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>{meta}</div>
      </button>
    );
  }

  return (
    <button type="button" className="cos-fx-row" onClick={onClick} title={item.title} style={{ ...baseStyle, display: "flex", alignItems: "center", gap: 10 }}>
      {kindPill}
      {titleText}
      {meta}
      <span aria-hidden="true" className="cos-fx-row-go" style={{ color: tone, fontSize: 15, lineHeight: 1, flex: "0 0 auto" }}>
        →
      </span>
    </button>
  );
}
