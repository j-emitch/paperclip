/**
 * Pure Build-Atlas view-model — the only place the Atlas UI computes anything.
 *
 * Everything here is a pure function of `BuildAtlasV1` (+ a `now` clock for the
 * "stale" threshold). The TSX components render this output verbatim; they never
 * derive atlas state themselves. This honours the COS-0 import boundary: contract
 * TYPES only — no sources, no projections, no Node, no zod. Freshness phrasing is
 * the shared `relativeTime`, so "3m ago" reads identically to the Board it
 * replaces.
 *
 * The staleness math lives once in `shared/derive-freshness` (5i cohesion audit);
 * the Atlas UI reads it only through the shared `SurfaceFreshnessBadge`, so this
 * view-model no longer re-exports freshness at all — the badge owns the 5-min
 * stale / 60-s clock-skew tolerance for every surface.
 */

import type {
  AtlasDiagnosticV1,
  BuildAtlasV1,
  DomainV1,
  FamilyV1,
  GateState,
} from "../../contracts/index.js";
import { relativeTime } from "../shared/time.js";

// `relativeTime` is shared across cockpit surfaces — re-exported so Atlas components
// (FamilyCard) keep one import site while the impl lives once in `shared/time`.
export { relativeTime };

/** The Spec·Plan·Build·Prod lifecycle gates, in render order. */
export const LIFECYCLE_GATES = ["spec", "plan", "build", "prod"] as const;
export type LifecycleGate = (typeof LIFECYCLE_GATES)[number];

/** Human gate labels for the stepper pips. */
export const GATE_LABELS: Record<LifecycleGate, string> = {
  spec: "Spec",
  plan: "Plan",
  build: "Build",
  prod: "Prod",
};

/** Human gate-state labels (for aria / tooltips). */
export const GATE_STATE_LABELS: Record<GateState, string> = {
  done: "done",
  active: "in progress",
  warn: "needs attention",
  todo: "not started",
};

/** Human plan-gap phrasing — only the gap states surface a pill. */
export const PLAN_GAP_LABELS: Record<"none" | "partial", string> = {
  none: "no plan",
  partial: "plan gap",
};

// ---------------------------------------------------------------------------
// View preparation
// ---------------------------------------------------------------------------

/** A domain section prepared for render: the domain + its resolved families in order. */
export interface DomainSection {
  domain: DomainV1;
  families: FamilyV1[];
  /** Shipped builds across the section's families (the section built rollup). */
  shipped: number;
  /** Total builds across the section's families. */
  total: number;
}

/** The at-a-glance vitals for the masthead. */
export interface AtlasVitals {
  familyCount: number;
  domainCount: number;
  shippedBuilds: number;
  totalBuilds: number;
  /** Human built rollup ("18 shipped · 42 builds"). */
  builtSummary: string;
  diagnosticsCount: number;
  laneCount: number;
  edgeCount: number;
}

/** Diagnostics prepared for the rail: worst-first (total-ordered) + severity counts. */
export interface DiagnosticsView {
  sorted: AtlasDiagnosticV1[];
  warnCount: number;
  infoCount: number;
}

/** The fully prepared atlas: domain sections (each with ordered families) + vitals + diagnostics. */
export interface AtlasView {
  sections: DomainSection[];
  vitals: AtlasVitals;
  diagnostics: DiagnosticsView;
}

/** Warn before info — the atlas rail surfaces derivation problems worst-first. */
const SEVERITY_RANK: Record<AtlasDiagnosticV1["severity"], number> = { warn: 0, info: 1 };

/**
 * Total order over diagnostics so the rail is deterministic regardless of the
 * projection's emit order: severity (warn first) → code → prefix (null last) →
 * message. Every comparator step is total, so `Array.sort` is stable + testable.
 */
export function sortDiagnostics(diagnostics: readonly AtlasDiagnosticV1[]): AtlasDiagnosticV1[] {
  return [...diagnostics].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.code.localeCompare(b.code) ||
      Number(a.prefix === null) - Number(b.prefix === null) || // a null prefix (global) sorts last
      (a.prefix ?? "").localeCompare(b.prefix ?? "") ||
      a.message.localeCompare(b.message),
  );
}

/**
 * Group families into their domain sections. Domain + family order is taken from
 * the projection verbatim (already deterministically sorted by `deriveBuildAtlas`).
 * A family named by a domain but missing from `families` is skipped defensively
 * (the projection never emits that, but the view must not crash on a bad row).
 */
export function buildAtlasView(atlas: BuildAtlasV1): AtlasView {
  const byPrefix = new Map<string, FamilyV1>();
  for (const fam of atlas.families) byPrefix.set(fam.prefix, fam);

  const sections: DomainSection[] = atlas.domains.map((domain): DomainSection => {
    const families = domain.families
      .map((prefix) => byPrefix.get(prefix))
      .filter((f): f is FamilyV1 => f !== undefined);
    const shipped = families.reduce((sum, f) => sum + countShipped(f), 0);
    const total = families.reduce((sum, f) => sum + f.builds.length, 0);
    return { domain, families, shipped, total };
  });

  const shippedBuilds = atlas.families.reduce((sum, f) => sum + countShipped(f), 0);
  const totalBuilds = atlas.families.reduce((sum, f) => sum + f.builds.length, 0);
  const laneCount = atlas.laneGroups.reduce((sum, g) => sum + g.lanes.length, 0);
  const warnCount = atlas.diagnostics.filter((d) => d.severity === "warn").length;

  return {
    sections,
    vitals: {
      familyCount: atlas.families.length,
      domainCount: atlas.domains.length,
      shippedBuilds,
      totalBuilds,
      builtSummary: builtRollup(shippedBuilds, totalBuilds),
      diagnosticsCount: atlas.diagnostics.length,
      laneCount,
      edgeCount: atlas.edges.length,
    },
    diagnostics: {
      sorted: sortDiagnostics(atlas.diagnostics),
      warnCount,
      infoCount: atlas.diagnostics.length - warnCount,
    },
  };
}

function countShipped(fam: FamilyV1): number {
  return fam.builds.filter((b) => b.state === "shipped").length;
}

function builtRollup(shipped: number, total: number): string {
  if (total === 0) return "no builds yet";
  return `${shipped} shipped · ${total} build${total === 1 ? "" : "s"}`;
}

/**
 * True only when there is genuinely nothing to show — no families at all (no
 * registered prefix produced a card). A family WITH zero builds is NOT empty: it
 * renders its 0-count card (Joe: show the 0, don't hide the state). The cold
 * cache (a null atlas) is handled by the caller as the EmptyState path.
 */
export function isAtlasEmpty(atlas: BuildAtlasV1): boolean {
  return atlas.families.length === 0;
}

/**
 * Resolve a `board` deep-link's `workId` to the family that hosts it (B1).
 * Match order: a build's `ticketId` → a routed ticket `identifier` → the
 * workId's own `PREFIX-` when that family exists (a ticket the atlas hasn't
 * routed yet still lands on its family). Null = typed miss — the caller renders
 * the miss note instead of silently dropping the target (unticketed evidence
 * strings and routine keys land here by design).
 */
export function findFamilyForWork(atlas: BuildAtlasV1, workId: string): string | null {
  for (const family of atlas.families) {
    if (family.builds.some((b) => b.ticketId === workId)) return family.prefix;
    if (family.tickets.some((t) => t.identifier === workId)) return family.prefix;
  }
  const prefix = /^([A-Z]+)-/.exec(workId)?.[1];
  if (prefix !== undefined && atlas.families.some((f) => f.prefix === prefix)) return prefix;
  return null;
}
