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
 * The staleness helpers mirror the Board's thresholds exactly (5-min stale, 60-s
 * clock-skew tolerance). Unifying them + the freshness badge with the Board's
 * `view-model`/`StaleBadge` into one shared surface-freshness primitive is a real
 * cohesion win, but it retrofits shipped + tested Board code — sequenced to the
 * 5i cohesion audit (its designated HEAVY-REVIEW gate), not this additive UI phase.
 */

import type {
  BuildAtlasV1,
  DomainV1,
  FamilyV1,
  GateState,
  SourceFreshness,
} from "../../contracts/index.js";
import { relativeTime } from "../shared/time.js";

// Re-exported so Atlas components + tests keep one import site while the impl lives once.
export { relativeTime };

/** The atlas is "stale" (surface-level badge) when its derive is older than this. */
export const ATLAS_STALE_THRESHOLD_MS = 5 * 60 * 1000;

/** A derive timestamp more than this far in the future is treated as clock skew, not "live". */
export const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

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

/** The fully prepared atlas: domain sections (each with ordered families) + vitals. */
export interface AtlasView {
  sections: DomainSection[];
  vitals: AtlasVitals;
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

// ---------------------------------------------------------------------------
// Freshness (mirrors the Board's thresholds — see the 5i cohesion note above)
// ---------------------------------------------------------------------------

/** Signed skew: derivedAt − now. Positive ⇒ the derive is stamped in the future. */
export function deriveSkewMs(atlas: BuildAtlasV1, now: number): number {
  const derivedAt = Date.parse(atlas.derivedAt);
  if (Number.isNaN(derivedAt)) return 0;
  return derivedAt - now;
}

export function isClockSkewed(atlas: BuildAtlasV1, now: number): boolean {
  return deriveSkewMs(atlas, now) > CLOCK_SKEW_TOLERANCE_MS;
}

/** Age of the derive in ms relative to `now`; never negative (clock skew → 0). */
export function deriveAgeMs(atlas: BuildAtlasV1, now: number): number {
  const derivedAt = Date.parse(atlas.derivedAt);
  if (Number.isNaN(derivedAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - derivedAt);
}

/** Surface-level staleness — derive older than the threshold. */
export function isAtlasStale(atlas: BuildAtlasV1, now: number): boolean {
  return deriveAgeMs(atlas, now) > ATLAS_STALE_THRESHOLD_MS;
}

/** Sources that are not `live` — drive the per-source stale badges + the summary. */
export function staleSources(atlas: BuildAtlasV1): SourceFreshness[] {
  return atlas.sources.filter((s) => s.freshness !== "live");
}
