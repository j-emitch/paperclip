/**
 * `<ProjectSection>` — the single project-grouping primitive (1d.8). Home, Source,
 * and Docs all wrap their per-project content in this, so the taxonomy-driven
 * header (display name · kind · member repos) and the calm 0-state (Joe's
 * "show 0 counts" rule) read identically across every surface. Pure presentation:
 * the projection supplies the grouped data, this renders the frame.
 */

import type { ReactNode } from "react";
import type { ProjectGroupV1 } from "../../contracts/projects.js";
import { tokens } from "../tokens.js";

const KIND_LABEL: Record<ProjectGroupV1["kind"], string> = {
  company: "Company",
  product: "Product",
  side_project: "Side project",
  platform: "Platform",
};

export interface ProjectSectionProps {
  readonly group: ProjectGroupV1;
  /** A small tabular count (branches / docs) shown next to the title. */
  readonly count?: number;
  /** Right-aligned header slot (e.g. a "see all →" link). */
  readonly action?: ReactNode;
  /** True when the section has no items — renders the calm 0-state instead of children. */
  readonly isEmpty?: boolean;
  /** The 0-state copy (Joe's positive, non-empty-hostile framing). */
  readonly emptyLabel?: string;
  /**
   * Compact glance mode (Home): suppress the prose note + tighten the header,
   * so the same project family repeated across Home panels doesn't re-print its
   * one-liner. The full Source/Docs audit leaves this off to keep the context.
   */
  readonly compact?: boolean;
  readonly children?: ReactNode;
}

export function ProjectSection({
  group,
  count,
  action,
  isEmpty = false,
  emptyLabel = "All clear here.",
  compact = false,
  children,
}: ProjectSectionProps) {
  return (
    <section aria-label={group.displayName} style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: compact ? 13.5 : 15, fontWeight: 650, letterSpacing: -0.2, color: tokens.fg }}>
          {group.displayName}
        </h3>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: tokens.muted,
            padding: "1px 7px",
            borderRadius: 999,
            border: `1px solid ${tokens.border}`,
          }}
        >
          {KIND_LABEL[group.kind]}
        </span>
        {typeof count === "number" ? (
          <span style={{ fontSize: 12, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{count}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {action}
      </header>
      {group.note && !compact ? (
        <p style={{ margin: 0, fontSize: 12, color: tokens.muted, lineHeight: 1.4 }}>{group.note}</p>
      ) : null}
      {isEmpty ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: tokens.muted,
            padding: "10px 12px",
            border: `1px dashed ${tokens.border}`,
            borderRadius: tokens.radiusSm,
          }}
        >
          {emptyLabel}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
      )}
    </section>
  );
}
