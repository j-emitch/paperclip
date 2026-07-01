/**
 * `SkillTree` — the Skills list pane: origin section (Company, the star →
 * Installed plugins, secondary) → collection bucket → skill rows. Each row shows
 * the skill name and its one-line summary; selecting it carries the entry up so
 * the reader can render the full SKILL.md. Pure + SSR-faithful, mirroring `DocTree`.
 */

import type { SkillsCatalogV1, SkillEntryV1, SkillOriginSectionV1 } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { ORIGIN_BLURB, ORIGIN_TONE, collectionTone } from "./skills-view-model.js";

export interface SkillSelection {
  entry: SkillEntryV1;
}

export interface SkillTreeProps {
  catalog: SkillsCatalogV1;
  selectedSkillId: string | null;
  onSelect: (selection: SkillSelection) => void;
  /** True while a search is active — an empty result then shows "no match" instead of the show-0 shells. */
  searching?: boolean;
}

export function SkillTree({ catalog, selectedSkillId, onSelect, searching = false }: SkillTreeProps) {
  // A search that matches nothing prunes every origin → a single calm note.
  if (searching && catalog.origins.length === 0) {
    return <CalmNote>No skills match — clear the search to see the full catalog.</CalmNote>;
  }
  // Otherwise render EVERY origin section (company first, plugins second) even at
  // 0 — the projection deliberately emits both for a stable show-0 topology.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
      {catalog.origins.map((origin, i) => (
        <div key={origin.origin} className="cos-fx-enter" style={{ animationDelay: `${i * 70}ms` }}>
          <OriginSection origin={origin} selectedSkillId={selectedSkillId} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

function OriginSection({
  origin,
  selectedSkillId,
  onSelect,
}: {
  origin: SkillOriginSectionV1;
  selectedSkillId: string | null;
  onSelect: (selection: SkillSelection) => void;
}) {
  const tone = ORIGIN_TONE[origin.origin];
  const isStar = origin.origin === "company";
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {/* Origin header — a tone spine + label + count; the star gets a blurb. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span aria-hidden="true" style={{ width: 3, height: 16, borderRadius: 2, background: tone, display: "inline-block" }} />
          <h3
            style={{
              margin: 0,
              fontSize: isStar ? 14.5 : 13,
              fontWeight: 700,
              letterSpacing: -0.2,
              color: tokens.fg,
              textTransform: isStar ? "none" : "uppercase",
            }}
          >
            {origin.label}
          </h3>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: tone,
              background: tokens.secondary,
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {origin.count}
          </span>
        </div>
        {isStar ? (
          <p style={{ margin: "0 0 0 12px", fontSize: 12, color: tokens.muted, lineHeight: 1.45, maxWidth: 520 }}>
            {ORIGIN_BLURB[origin.origin]}
          </p>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginLeft: 12 }}>
        {origin.collections.length === 0 ? (
          <CalmNote>
            {isStar
              ? "No company skills indexed yet — they appear on the next derive."
              : "No installed-plugin skills found. Point the plugin at a skills cache to populate this."}
          </CalmNote>
        ) : null}
        {origin.collections.map((collection) => (
          <section key={collection.collection} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Dot tone={collectionTone(origin.origin, collection.collection)} size={6} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>
                {collection.label}
              </span>
              <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{collection.skills.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {collection.skills.map((skill) => (
                <SkillRow
                  key={skill.skillId}
                  skill={skill}
                  selected={skill.skillId === selectedSkillId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function SkillRow({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillEntryV1;
  selected: boolean;
  onSelect: (selection: SkillSelection) => void;
}) {
  return (
    <button
      type="button"
      className="cos-fx-row"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect({ entry: skill })}
      title={skill.summary ?? skill.name}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "9px 11px",
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
          fontSize: 13,
          fontWeight: selected ? 700 : 600,
          fontFamily: tokens.mono,
          color: selected ? tokens.fg : tokens.fg,
          letterSpacing: -0.2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {skill.name}
      </span>
      {skill.summary ? (
        <span
          style={{
            fontSize: 11.5,
            color: tokens.muted,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {skill.summary}
        </span>
      ) : null}
    </button>
  );
}
