/**
 * Pure, selectable list of artifacts (the master column of the Reports tab). Each
 * row is a focusable button carrying the doc's title, type, repo, prefix, and
 * relative mtime; the selected row is highlighted. Filtered-to-empty renders an
 * inline "no matches" hint rather than vanishing. No SDK runtime — SSR-faithful.
 */

import type { ArtifactEntry } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill, RepoBadge } from "../shared/badges.js";
import { relativeTime } from "../shared/time.js";
import { ARTIFACT_TYPE_LABELS, baseName, selectionKey } from "./reports-view-model.js";

export interface ReportListProps {
  entries: ArtifactEntry[];
  selectedKey: string | null;
  onSelect: (entry: ArtifactEntry) => void;
  now: number;
  isMobile?: boolean;
}

export function ReportList({ entries, selectedKey, onSelect, now, isMobile = false }: ReportListProps) {
  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: "28px 18px",
          textAlign: "center",
          color: tokens.muted,
          fontSize: 13,
          background: tokens.bg,
          border: `1px dashed ${tokens.border}`,
          borderRadius: tokens.radiusSm,
        }}
      >
        No reports match these filters.
      </div>
    );
  }

  return (
    <ul
      aria-label="Reports"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: isMobile ? "none" : 560,
        overflowY: isMobile ? "visible" : "auto",
      }}
    >
      {entries.map((entry) => {
        const key = selectionKey(entry);
        const selected = key === selectedKey;
        const mtimeLabel = relativeTime(entry.mtime, now);
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              aria-current={selected ? "true" : undefined}
              className="cos-chip-hover"
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "9px 11px",
                borderRadius: tokens.radiusSm,
                border: `1px solid ${selected ? tokens.accentBorder : "transparent"}`,
                background: selected ? tokens.accentSoft : tokens.bg,
                color: tokens.fg,
                font: "inherit",
                cursor: "pointer",
                transition: "background-color 140ms ease, border-color 140ms ease",
              }}
            >
              <span
                title={entry.title ?? baseName(entry.relPath)}
                style={{
                  fontSize: 13,
                  fontWeight: selected ? 650 : 550,
                  color: tokens.fg,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.title ?? baseName(entry.relPath)}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Pill label={ARTIFACT_TYPE_LABELS[entry.artifactType]} tone={tokens.muted} />
                <RepoBadge repo={entry.repo} />
                {entry.prefix ? (
                  <span style={{ fontSize: 10.5, fontFamily: tokens.mono, color: tokens.muted, fontWeight: 600 }}>{entry.prefix}</span>
                ) : null}
                {mtimeLabel ? <span style={{ fontSize: 11, color: tokens.muted, marginLeft: "auto" }}>{mtimeLabel}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
