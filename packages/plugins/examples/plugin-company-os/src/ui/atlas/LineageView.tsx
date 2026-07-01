/**
 * `LineageView` — the declarative lineage layer rendered as lane-group clusters:
 * the value-chain flow lanes, overlay clusters, and the distinct Second-Brain
 * lane. Each family is a focusable node carrying a mini Spec·Plan·Build·Prod
 * lifecycle; a node that only receives edges (in-degree > 0, out-degree 0) is
 * marked a pseudo-sink. The whole thing summarises the edge graph without a
 * fragile free-form SVG — legible, keyboard-scannable, and SSR-faithful.
 *
 * Pure + prop-driven. Node → family: the aria-label names the family + its
 * lifecycle so a screen reader gets the lineage; the detail lives on the family
 * cards above. Reuses shared tokens + the LifecycleStepper mini size.
 */

import type { CSSProperties } from "react";
import type { FamilyV1, LaneGroupV1, LineageEdgeV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { withAlpha } from "../shared/color.js";
import { LifecycleStepper } from "./LifecycleStepper.js";

/** Kind → accent tone. Second-Brain gets a distinct violet so it reads apart from the value chain. */
const SECOND_BRAIN_TONE = "oklch(0.74 0.13 300)";
const GROUP_TONE: Record<string, string> = {
  flow: tokens.accent,
  overlay: statusColors.proceed,
  "second-brain": SECOND_BRAIN_TONE,
};

/** Kind → human sublabel shown beside the group title. */
const GROUP_KIND_LABEL: Record<string, string> = {
  flow: "value chain",
  overlay: "overlay",
  "second-brain": "second brain",
};

export interface LineageViewProps {
  laneGroups: readonly LaneGroupV1[];
  edges: readonly LineageEdgeV1[];
  families: readonly FamilyV1[];
  isMobile?: boolean;
}

export function LineageView({ laneGroups, edges, families, isMobile = false }: LineageViewProps) {
  if (laneGroups.length === 0) return null;

  const familyByPrefix = new Map<string, FamilyV1>();
  for (const fam of families) familyByPrefix.set(fam.prefix, fam);

  // Per-node in/out edge degree → directional flow hints + pseudo-sink detection.
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const degreeOf = (prefix: string): NodeDegree => ({ in: inDeg.get(prefix) ?? 0, out: outDeg.get(prefix) ?? 0 });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>Lineage</h3>
        <span style={{ fontSize: 11.5, color: tokens.muted }}>
          {laneGroups.length} group{laneGroups.length === 1 ? "" : "s"} · {edges.length} link{edges.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {laneGroups.map((group) => (
          <LaneGroupCard key={group.id} group={group} familyByPrefix={familyByPrefix} degreeOf={degreeOf} isMobile={isMobile} />
        ))}
      </div>
    </section>
  );
}

/** A node's lineage connectivity — incoming + outgoing edge counts. */
interface NodeDegree {
  in: number;
  out: number;
}

function LaneGroupCard({
  group,
  familyByPrefix,
  degreeOf,
  isMobile,
}: {
  group: LaneGroupV1;
  familyByPrefix: Map<string, FamilyV1>;
  degreeOf: (prefix: string) => NodeDegree;
  isMobile: boolean;
}) {
  const tone = GROUP_TONE[group.kind] ?? tokens.muted;
  const kindLabel = GROUP_KIND_LABEL[group.kind] ?? group.kind;
  const secondBrain = group.kind === "second-brain";

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${secondBrain ? withAlpha(tone, 0.42) : tokens.border}`,
        borderTop: `3px solid ${tone}`,
        borderRadius: tokens.radius,
        padding: isMobile ? 12 : 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: tokens.fg }}>{group.title}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: tone,
            padding: "1px 7px",
            borderRadius: 999,
            background: withAlpha(tone, 0.14),
            border: `1px solid ${withAlpha(tone, 0.42)}`,
          }}
        >
          {kindLabel}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : `repeat(auto-fit, minmax(${secondBrain ? 200 : 180}px, 1fr))`,
          gap: 10,
        }}
      >
        {group.lanes.map((lane) => (
          <div key={lane.id} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: tokens.muted }}>{lane.title}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lane.families.length === 0 ? (
                <span style={{ fontSize: 11.5, color: tokens.muted }}>—</span>
              ) : (
                lane.families.map((prefix) => (
                  <LineageNode key={prefix} prefix={prefix} family={familyByPrefix.get(prefix) ?? null} tone={tone} degree={degreeOf(prefix)} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single family node — prefix + mini lifecycle + directional edge hints; focusable. */
function LineageNode({ prefix, family, tone, degree }: { prefix: string; family: FamilyV1 | null; tone: string; degree: NodeDegree }) {
  const sink = degree.in > 0 && degree.out === 0;
  const flow =
    (degree.in > 0 ? `${degree.in} incoming` : "") +
    (degree.in > 0 && degree.out > 0 ? ", " : "") +
    (degree.out > 0 ? `${degree.out} outgoing` : "");
  const aria =
    (family ? `${prefix} ${family.name}` : prefix) +
    (family ? ` — Spec ${family.lifecycle.spec}, Plan ${family.lifecycle.plan}, Build ${family.lifecycle.build}, Prod ${family.lifecycle.prod}` : "") +
    (flow ? ` — lineage ${flow}` : "") +
    (sink ? " (pseudo-sink)" : "");
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    background: tokens.cardElevated,
    border: `1px solid ${withAlpha(tone, 0.42)}`,
    minWidth: 0,
    outline: "none",
  };
  return (
    <span className="cos-chip-hover" role="group" tabIndex={0} aria-label={aria} title={aria} style={style}>
      <span style={{ fontFamily: tokens.mono, fontSize: 11.5, fontWeight: 700, color: tokens.fg, letterSpacing: 0.2 }}>{prefix}</span>
      {family ? <LifecycleStepper lifecycle={family.lifecycle} isRolling={family.isRolling} size="mini" /> : null}
      <DegreeHints degree={degree} sink={sink} tone={tone} />
    </span>
  );
}

/** Compact directional edge hints — "←N" incoming, "→N" outgoing; a sink gets a dot. */
function DegreeHints({ degree, sink, tone }: { degree: NodeDegree; sink: boolean; tone: string }) {
  if (degree.in === 0 && degree.out === 0) return null;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.muted, flex: "0 0 auto" }}>
      {degree.in > 0 ? <span title={`${degree.in} incoming`}>←{degree.in}</span> : null}
      {degree.out > 0 ? <span title={`${degree.out} outgoing`}>→{degree.out}</span> : null}
      {sink ? <span title="pseudo-sink" style={{ width: 4, height: 4, borderRadius: 999, background: tone }} /> : null}
    </span>
  );
}
