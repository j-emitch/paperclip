/**
 * `DocTree` — the Docs list pane: project family (shared `<ProjectSection>`,
 * compact — this is a navigation list) → doc-type bucket (Specs · Plans ·
 * Handoffs · Backlog · Reviews) → doc rows. Each row shows its title, a
 * provenance badge (main vs a worktree), and its mtime; selecting it carries the
 * doc's bucket `type` up so the viewer can label it (the `DocEntryV1` doesn't
 * carry its own type). Pure + SSR-faithful.
 */

import type { DocEntryV1, DocIndexV1, DocProjectSectionV1 } from "../../contracts/index.js";
import type { DocIndexType } from "../../contracts/vocab.js";
import { tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ProjectSection } from "../shared/ProjectSection.js";
import { ClockIcon } from "../icons.js";
import { relativeTime, safeTime } from "../shared/time.js";
import { ProvenanceBadge } from "./ProvenanceBadge.js";
import { DOC_TYPE_LABELS, DOC_TYPE_ORDER, DOC_TYPE_TONES, docTitle } from "./docs-view-model.js";

export interface DocSelection {
  entry: DocEntryV1;
  type: DocIndexType;
}

export interface DocTreeProps {
  docIndex: DocIndexV1;
  selectedDocId: string | null;
  onSelect: (selection: DocSelection) => void;
  now: number;
}

function sectionDocCount(section: DocProjectSectionV1): number {
  return section.types.reduce((sum, b) => sum + b.docs.length, 0);
}

export function DocTree({ docIndex, selectedDocId, onSelect, now }: DocTreeProps) {
  const groups = docIndex.groups;
  const totalDocs = groups.reduce((sum, s) => sum + sectionDocCount(s), 0);
  // `deriveDocIndex` deliberately emits EVERY taxonomy group (show-0-counts), so
  // don't filter empties out here. When the whole workspace is empty, one calm
  // message reads better than a column of empty headers; once ANY project has
  // docs, show EVERY project so an empty family reads as "0 docs" beside its
  // populated siblings (mirrors SkillTree's empty-origin note).
  if (totalDocs === 0) {
    return <CalmNote>No documents indexed yet — specs, plans, handoffs, and reviews appear here on the next derive.</CalmNote>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      {groups.map((section, i) => {
        const count = sectionDocCount(section);
        return (
          <div key={section.group.key} className="cos-fx-enter" style={{ animationDelay: `${i * 60}ms` }}>
            <ProjectSection group={section.group} count={count} compact>
              {count === 0 ? (
                <CalmNote>No documents in this project yet.</CalmNote>
              ) : (
                orderedBuckets(section).map(({ type, docs }) => (
                  <DocTypeGroup
                    key={type}
                    type={type}
                    docs={docs}
                    selectedDocId={selectedDocId}
                    onSelect={onSelect}
                    now={now}
                  />
                ))
              )}
            </ProjectSection>
          </div>
        );
      })}
    </div>
  );
}

function orderedBuckets(section: DocProjectSectionV1): { type: DocIndexType; docs: readonly DocEntryV1[] }[] {
  const byType = new Map(section.types.map((b) => [b.type, b.docs] as const));
  const out: { type: DocIndexType; docs: readonly DocEntryV1[] }[] = [];
  for (const type of DOC_TYPE_ORDER) {
    const docs = byType.get(type);
    if (docs && docs.length > 0) out.push({ type, docs });
  }
  return out;
}

function DocTypeGroup({
  type,
  docs,
  selectedDocId,
  onSelect,
  now,
}: {
  type: DocIndexType;
  docs: readonly DocEntryV1[];
  selectedDocId: string | null;
  onSelect: (selection: DocSelection) => void;
  now: number;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Dot tone={DOC_TYPE_TONES[type]} size={6} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>
          {DOC_TYPE_LABELS[type]}
        </span>
        <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{docs.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {[...docs]
          .sort((a, b) => safeTime(b.mtime) - safeTime(a.mtime))
          .map((entry) => (
            <DocRow key={entry.docId} entry={entry} type={type} selected={entry.docId === selectedDocId} onSelect={onSelect} now={now} />
          ))}
      </div>
    </section>
  );
}

function DocRow({
  entry,
  type,
  selected,
  onSelect,
  now,
}: {
  entry: DocEntryV1;
  type: DocIndexType;
  selected: boolean;
  onSelect: (selection: DocSelection) => void;
  now: number;
}) {
  const age = relativeTime(entry.mtime, now);
  // Two-line: the TITLE owns its own line (so a long worktree provenance badge
  // never squeezes it to "COS-…"), with the provenance + mtime on a calm meta line.
  return (
    <button
      type="button"
      className="cos-fx-row"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect({ entry, type })}
      title={docTitle(entry)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 10px",
        width: "100%",
        minWidth: 0,
        textAlign: "left",
        background: selected ? tokens.accentSoft : tokens.card,
        border: `1px solid ${selected ? tokens.accentBorder : tokens.border}`,
        borderRadius: tokens.radiusSm,
        color: tokens.fg,
        font: "inherit",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: "100%",
          minWidth: 0,
          fontSize: 12.5,
          fontWeight: selected ? 600 : 500,
          color: tokens.fg,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {docTitle(entry)}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
        <ProvenanceBadge entry={entry} />
        <span style={{ flex: 1 }} />
        {age ? (
          <span style={{ fontSize: 11, color: tokens.muted, whiteSpace: "nowrap", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>
            <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "-2px", marginRight: 3 }}>
              <ClockIcon size={11} />
            </span>
            {age}
          </span>
        ) : null}
      </div>
    </button>
  );
}
