/**
 * Pure view-model for the Teaching tab (COS-2f) — folds a `TeachingOverviewV1` +
 * the active filter into the faceted, unit-grouped shape the TSX renders verbatim.
 * Faceted-search semantics mirror the Reports tab: each facet's counts reflect the
 * OTHER active filters, while the visible list applies them all. Tones reuse the
 * cockpit's shared status palette so a publish-state reads the same hue family the
 * board + routines use. Imports contract TYPES only — SSR-safe + unit-testable.
 */

import type { TeachingOverviewV1, TeachingUnitEntry } from "../../contracts/index.js";
import type {
  RoutineVerdict,
  TeachingAudience,
  TeachingLens,
  TeachingPublishState,
} from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";

/** Sentinel for "no filter on this dimension". */
export const ALL = "all" as const;

// --- audience -----------------------------------------------------------------
export const AUDIENCE_LABELS: Record<TeachingAudience, string> = {
  internal: "Internal",
  external: "External",
  both: "Both",
};
export const AUDIENCE_ORDER: readonly TeachingAudience[] = ["internal", "external", "both"];
export const AUDIENCE_TONES: Record<TeachingAudience, string> = {
  internal: statusColors.reviewUnknown,
  external: tokens.accent,
  both: statusColors.proceed,
};

// --- publish state ------------------------------------------------------------
export const PUBLISH_LABELS: Record<TeachingPublishState, string> = {
  private: "Private",
  candidate: "Candidate",
  ready: "Ready",
  published: "Published",
};
export const PUBLISH_ORDER: readonly TeachingPublishState[] = ["private", "candidate", "ready", "published"];
export const PUBLISH_TONES: Record<TeachingPublishState, string> = {
  private: statusColors.reviewUnknown,
  candidate: statusColors.cached,
  ready: statusColors.proceed,
  published: statusColors.ship,
};

// --- lens ---------------------------------------------------------------------
export const LENS_LABELS: Record<TeachingLens, string> = {
  internal: "Internal",
  external: "External",
  unspecified: "Unmigrated",
};
export const LENS_TONES: Record<TeachingLens, string> = {
  internal: statusColors.reviewUnknown,
  external: tokens.accent,
  unspecified: statusColors.cached,
};

// --- synthesis verdict (reuses the routine-health ladder) ---------------------
export const SYNTH_VERDICT_LABELS: Record<RoutineVerdict, string> = {
  fresh: "Fresh",
  stale: "Stale",
  missing: "Missing",
  never_ran: "Never run",
};
export const SYNTH_VERDICT_TONES: Record<RoutineVerdict, string> = {
  fresh: statusColors.live,
  stale: statusColors.cached,
  missing: statusColors.danger,
  never_ran: statusColors.reviewUnknown,
};

export const ATTENTION_TONES = {
  ok: statusColors.live,
  attention: statusColors.cached,
  critical: statusColors.danger,
} as const;

export interface TeachingFilter {
  audience: TeachingAudience | typeof ALL;
  publishState: TeachingPublishState | typeof ALL;
  lens: TeachingLens | typeof ALL;
  /** Free-text over title + unit + path (case-insensitive). */
  search: string;
}

export const EMPTY_TEACHING_FILTER: TeachingFilter = { audience: ALL, publishState: ALL, lens: ALL, search: "" };

export interface Facet<V extends string = string> {
  value: V;
  label: string;
  count: number;
}

/** A unit directory's lessons (the tab groups the corpus by numbered unit). */
export interface UnitGroup {
  unit: string;
  entries: TeachingUnitEntry[];
}

export interface TeachingView {
  groups: UnitGroup[];
  /** Total units in the corpus (unfiltered). */
  total: number;
  /** Count after the full filter. */
  shown: number;
  audienceFacets: Facet<TeachingAudience | typeof ALL>[];
  publishFacets: Facet<TeachingPublishState | typeof ALL>[];
  lensFacets: Facet<TeachingLens | typeof ALL>[];
}

type FacetDim = "audience" | "publishState" | "lens";

/** Does an entry match the filter, optionally ignoring ONE dimension (for facet counts)? */
function matches(entry: TeachingUnitEntry, filter: TeachingFilter, ignore: FacetDim | null): boolean {
  if (ignore !== "audience" && filter.audience !== ALL && entry.audience !== filter.audience) return false;
  if (ignore !== "publishState" && filter.publishState !== ALL && entry.publishState !== filter.publishState) return false;
  if (ignore !== "lens" && filter.lens !== ALL && entry.lens !== filter.lens) return false;
  const q = filter.search.trim().toLowerCase();
  if (q) {
    const hay = `${entry.title} ${entry.unit ?? ""} ${entry.relPath}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function audienceFacets(units: readonly TeachingUnitEntry[], filter: TeachingFilter): Facet<TeachingAudience | typeof ALL>[] {
  const counts = new Map<TeachingAudience, number>();
  for (const u of units) if (matches(u, filter, "audience")) counts.set(u.audience, (counts.get(u.audience) ?? 0) + 1);
  const present = AUDIENCE_ORDER.filter((a) => (counts.get(a) ?? 0) > 0 || filter.audience === a);
  return [
    { value: ALL, label: "All", count: units.filter((u) => matches(u, filter, "audience")).length },
    ...present.map((a) => ({ value: a, label: AUDIENCE_LABELS[a], count: counts.get(a) ?? 0 })),
  ];
}

function publishFacets(units: readonly TeachingUnitEntry[], filter: TeachingFilter): Facet<TeachingPublishState | typeof ALL>[] {
  const counts = new Map<TeachingPublishState, number>();
  for (const u of units) if (matches(u, filter, "publishState")) counts.set(u.publishState, (counts.get(u.publishState) ?? 0) + 1);
  const present = PUBLISH_ORDER.filter((p) => (counts.get(p) ?? 0) > 0 || filter.publishState === p);
  return [
    { value: ALL, label: "All", count: units.filter((u) => matches(u, filter, "publishState")).length },
    ...present.map((p) => ({ value: p, label: PUBLISH_LABELS[p], count: counts.get(p) ?? 0 })),
  ];
}

function lensFacets(units: readonly TeachingUnitEntry[], filter: TeachingFilter): Facet<TeachingLens | typeof ALL>[] {
  const counts = new Map<TeachingLens, number>();
  for (const u of units) if (matches(u, filter, "lens")) counts.set(u.lens, (counts.get(u.lens) ?? 0) + 1);
  const order: readonly TeachingLens[] = ["internal", "external", "unspecified"];
  const present = order.filter((l) => (counts.get(l) ?? 0) > 0 || filter.lens === l);
  return [
    { value: ALL, label: "All", count: units.filter((u) => matches(u, filter, "lens")).length },
    ...present.map((l) => ({ value: l, label: LENS_LABELS[l], count: counts.get(l) ?? 0 })),
  ];
}

export function buildTeachingView(overview: TeachingOverviewV1, filter: TeachingFilter): TeachingView {
  const all = overview.units;
  const visible = all.filter((u) => matches(u, filter, null));

  const byUnit = new Map<string, TeachingUnitEntry[]>();
  for (const u of visible) {
    const key = u.unit ?? "Ungrouped";
    const list = byUnit.get(key);
    if (list) list.push(u);
    else byUnit.set(key, [u]);
  }
  const groups: UnitGroup[] = [...byUnit.entries()]
    .map(([unit, entries]): UnitGroup => ({
      unit,
      entries: [...entries].sort((a, b) => a.title.localeCompare(b.title) || a.relPath.localeCompare(b.relPath)),
    }))
    // "Ungrouped" sorts last; numbered units sort naturally (01-, 02-, …).
    .sort((a, b) => (a.unit === "Ungrouped" ? 1 : b.unit === "Ungrouped" ? -1 : a.unit.localeCompare(b.unit)));

  return {
    groups,
    total: all.length,
    shown: visible.length,
    audienceFacets: audienceFacets(all, filter),
    publishFacets: publishFacets(all, filter),
    lensFacets: lensFacets(all, filter),
  };
}

/** Prettify a unit dir (`03-migrations-and-staging` → `03 · Migrations And Staging`). */
export function prettyUnit(unit: string): string {
  if (unit === "Ungrouped") return "Ungrouped";
  const m = /^(\d+)-(.*)$/.exec(unit);
  const num = m ? m[1] : null;
  const rest = (m ? m[2] : unit).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return num ? `${num} · ${rest}` : rest;
}
