/**
 * Pure view-model for the Reports tab — the only place the docs viewer computes
 * anything. Folds an `ArtifactIndexV1` + the active filter into a sorted, faceted
 * `ReportsView` the TSX renders verbatim. Faceted-search semantics: each facet's
 * counts reflect the OTHER active filters (so narrowing by type updates the
 * system/prefix counts), while the visible list applies them all. Imports
 * contract TYPES only — no SDK runtime, so it's unit-testable + SSR-safe.
 */

import type { ArtifactEntry, ArtifactIndexV1, ArtifactType } from "../../contracts/index.js";

/** Sentinel for "no filter on this dimension". */
export const ALL = "all" as const;

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  spec: "Specs",
  handoff: "Handoffs",
  cannons: "Reviews",
  routine_output: "Routine output",
  teaching: "Teaching",
  knowledge: "Knowledge",
};

/** Display order for the type filter chips (matches the lifecycle the cockpit cares about). */
export const ARTIFACT_TYPE_ORDER: readonly ArtifactType[] = [
  "spec",
  "handoff",
  "cannons",
  "routine_output",
  "teaching",
  "knowledge",
];

/** Value used for entries whose system/prefix is null (so they remain filterable). */
export const UNSET_FACET = "(none)";

export interface ReportsFilter {
  type: ArtifactType | typeof ALL;
  system: string;
  prefix: string;
  repo: string;
  /** Free-text over title + path + prefix (case-insensitive). */
  search: string;
}

export const EMPTY_FILTER: ReportsFilter = { type: ALL, system: ALL, prefix: ALL, repo: ALL, search: "" };

export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface TypeFacet {
  value: ArtifactType | typeof ALL;
  label: string;
  count: number;
}

export interface ReportsView {
  /** Filtered entries, newest-first (mtime desc, then path). */
  entries: ArtifactEntry[];
  /** Total entries in the index (unfiltered). */
  total: number;
  /** Count after the full filter (entries.length). */
  shown: number;
  typeFacets: TypeFacet[];
  systemFacets: Facet[];
  prefixFacets: Facet[];
  repoFacets: Facet[];
}

/** Stable identity for an artifact across renders + the report-content fetch. */
export function selectionKey(entry: Pick<ArtifactEntry, "repo" | "relPath">): string {
  return `${entry.repo}::${entry.relPath}`;
}

/** The base name of a workspace-relative path (the docs list's primary line when no title). */
export function baseName(relPath: string): string {
  const parts = relPath.split("/");
  return parts[parts.length - 1] || relPath;
}

type FacetDim = "type" | "system" | "prefix" | "repo";

function facetValue(entry: ArtifactEntry, dim: FacetDim): string {
  switch (dim) {
    case "type":
      return entry.artifactType;
    case "system":
      return entry.system ?? UNSET_FACET;
    case "prefix":
      return entry.prefix ?? UNSET_FACET;
    case "repo":
      return entry.repo;
  }
}

/** Does an entry match the filter, optionally ignoring ONE dimension (for facet counts)? */
function matches(entry: ArtifactEntry, filter: ReportsFilter, ignore: FacetDim | null): boolean {
  if (ignore !== "type" && filter.type !== ALL && entry.artifactType !== filter.type) return false;
  if (ignore !== "system" && filter.system !== ALL && facetValue(entry, "system") !== filter.system) return false;
  if (ignore !== "prefix" && filter.prefix !== ALL && facetValue(entry, "prefix") !== filter.prefix) return false;
  if (ignore !== "repo" && filter.repo !== ALL && entry.repo !== filter.repo) return false;
  const q = filter.search.trim().toLowerCase();
  if (q) {
    const hay = `${entry.title ?? ""} ${entry.relPath} ${entry.prefix ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function countFacets(entries: readonly ArtifactEntry[], filter: ReportsFilter, dim: FacetDim): Facet[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!matches(e, filter, dim)) continue;
    const v = facetValue(e, dim);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildReportsView(index: ArtifactIndexV1, filter: ReportsFilter): ReportsView {
  const all = index.entries;

  const visible = all
    .filter((e) => matches(e, filter, null))
    .sort((a, b) => (b.mtime ?? "").localeCompare(a.mtime ?? "") || a.relPath.localeCompare(b.relPath));

  // Type facets: every type, in canonical order, counted against the OTHER filters.
  const typeCounts = new Map<ArtifactType, number>();
  for (const e of all) {
    if (matches(e, filter, "type")) typeCounts.set(e.artifactType, (typeCounts.get(e.artifactType) ?? 0) + 1);
  }
  const presentTypes = ARTIFACT_TYPE_ORDER.filter((t) => (typeCounts.get(t) ?? 0) > 0 || filter.type === t);
  const typeFacets: TypeFacet[] = [
    { value: ALL, label: "All", count: all.filter((e) => matches(e, filter, "type")).length },
    ...presentTypes.map((t): TypeFacet => ({ value: t, label: ARTIFACT_TYPE_LABELS[t], count: typeCounts.get(t) ?? 0 })),
  ];

  return {
    entries: visible,
    total: all.length,
    shown: visible.length,
    typeFacets,
    systemFacets: countFacets(all, filter, "system"),
    prefixFacets: countFacets(all, filter, "prefix"),
    repoFacets: countFacets(all, filter, "repo"),
  };
}
