/**
 * `deriveBuildAtlas` — the Build Atlas projection (spec §5, COS-5). A pure fold
 * of WorkSignals + DocSignals + TaxonomySignals into `BuildAtlasV1`: every
 * registered spec-prefix family (shown 0-count, like the Board's rows) becomes a
 * card carrying a lifecycle stepper (`deriveLifecycle`, decoupled from built-%),
 * a built bar, and its in-flight builds. Families group into domains (by L1
 * system).
 *
 * 5a populates families + domains + lifecycle + builds; the lineage lane-groups
 * (5b) and routed LYC tickets (5c) fold in later — their arrays are empty here.
 * Grouping is the Board's `l1:l2` taxonomy from `TaxonomySignal`s today; 5g
 * migrates both this and `deriveBoardState` onto the shared `resolveGrouping`
 * resolver. No I/O — the UI renders this verbatim.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  isDocSignal,
  isLineageSignal,
  isTaxonomySignal,
  isWorkSignal,
  type DocSignal,
  type LineageSignal,
  type TaxonomySignal,
  type WorkSignal,
} from "../contracts/signals.js";
import {
  BUILD_ATLAS_SCHEMA_VERSION,
  type AtlasDiagnosticV1,
  type BuildAtlasV1,
  type BuildV1,
  type DomainV1,
  type FamilyV1,
  type LaneGroupV1,
  type LineageEdgeV1,
} from "../contracts/build-atlas.js";
import type { WorkState } from "../contracts/vocab.js";
import { deriveLifecycle } from "./deriveLifecycle.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

/** Furthest-right stage wins the build's column (mirrors the Board's STAGE_RANK). */
const STAGE_RANK: Record<WorkState, number> = { next_up: 0, in_progress: 1, in_review: 2, shipped: 3 };

/**
 * Rolling programs — continuously-shipping families whose built bar reads
 * "· live" rather than a fixed %. Curated for 5a; 5g's registry reconciliation
 * becomes the durable home for this flag.
 */
const ROLLING_PREFIXES = new Set(["INFRA", "PULSE", "RE", "IMPRV", "GAP", "LYC", "STAGING", "PERF"]);

interface Taxon {
  readonly prefix: string;
  readonly family: string;
  readonly l1: string;
  readonly l2: string;
  readonly isGeneric: boolean;
  readonly laneId: string;
}

export function deriveBuildAtlas(bundle: SignalBundle, nowMs: number): BuildAtlasV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const work = signals.filter(isWorkSignal);
  const docs = signals.filter(isDocSignal);
  const taxonomy = buildTaxonomy(signals.filter(isTaxonomySignal));

  const workByPrefix = groupBy(work, (w) => w.prefix);
  const docsByPrefix = groupBy(docs, (d) => d.prefix);
  const diagnostics: AtlasDiagnosticV1[] = [];

  // Lineage fold — the freshest lineage signal (appended last in DEFAULT_SOURCES).
  const registered = new Set(taxonomy.keys());
  const lineageSig = signals.filter(isLineageSignal).at(-1) ?? null;
  const { laneGroups, edges, tagsByPrefix } = foldLineage(lineageSig, registered, diagnostics);

  // A family per registered prefix (show 0-count families, like the Board's rows).
  const families: FamilyV1[] = [];
  for (const taxon of [...taxonomy.values()].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    const famWork = workByPrefix.get(taxon.prefix) ?? [];
    const famDocs = docsByPrefix.get(taxon.prefix) ?? [];
    families.push(buildFamily(taxon, famWork, famDocs, tagsByPrefix.get(taxon.prefix) ?? []));
  }

  // Orphan-family completeness: a registered family in NO lane (only when a
  // lineage graph is present — no graph means "lineage not configured", not orphans).
  if (laneGroups.length > 0) {
    const laned = new Set(laneGroups.flatMap((g) => g.lanes.flatMap((l) => l.families)));
    for (const fam of families) {
      if (!laned.has(fam.prefix)) {
        diagnostics.push({
          code: "orphan_family",
          severity: "info",
          message: `family "${fam.prefix}" is in no lineage lane — assign it in build-atlas-lineage.json`,
          prefix: fam.prefix,
        });
      }
    }
  }

  // Work whose prefix parsed but isn't registered → an unknown-prefix diagnostic
  // (the Board routes these to its Ops lane; the Atlas surfaces them on the rail).
  const unknownPrefixes = new Set<string>();
  for (const w of work) {
    if (w.prefix && !registered.has(w.prefix)) unknownPrefixes.add(w.prefix);
  }
  for (const prefix of [...unknownPrefixes].sort()) {
    diagnostics.push({
      code: "unknown_prefix",
      severity: "warn",
      message: `work references unregistered prefix "${prefix}" — register it in company/config/prefix-registry.json`,
      prefix,
    });
  }

  const sources = aggregateSourceFreshness(bundle);
  return {
    schemaVersion: BUILD_ATLAS_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    sources,
    domains: buildDomains(families),
    families,
    laneGroups,
    edges,
    diagnostics,
    sourceDiagnostics: diagnosticsFromFreshness(sources),
  };
}

// ---------------------------------------------------------------------------
// Family assembly
// ---------------------------------------------------------------------------

function buildFamily(
  taxon: Taxon,
  work: readonly WorkSignal[],
  docs: readonly DocSignal[],
  lineageTags: readonly string[],
): FamilyV1 {
  const builds = resolveBuilds(work);
  const isRolling = ROLLING_PREFIXES.has(taxon.prefix);
  const shipped = builds.filter((b) => b.state === "shipped").length;
  const total = builds.length;
  const repos = distinctRepos(work);
  return {
    prefix: taxon.prefix,
    name: taxon.family,
    l1: taxon.l1,
    l2: taxon.l2,
    domain: taxon.l1,
    laneId: taxon.laneId,
    repos,
    isGeneric: taxon.isGeneric,
    isRolling,
    // Lifecycle reads the RESOLVED build states (not raw signals) so a reverted
    // ship never counts as shipped in the stepper — one resolution point.
    lifecycle: deriveLifecycle(taxon.prefix, docs, builds.map((b) => b.state)),
    builtPct: total === 0 ? 0 : Math.round((shipped / total) * 100),
    builtSummary: builtSummary(isRolling, builds),
    builds,
    tickets: [], // 5c — LYC routing
    lineageTags: [...lineageTags],
  };
}

// ---------------------------------------------------------------------------
// Lineage fold (5b) — the declarative graph → lane-groups + edges + tags
// ---------------------------------------------------------------------------

interface LineageFold {
  readonly laneGroups: LaneGroupV1[];
  readonly edges: LineageEdgeV1[];
  /** prefix → the OTHER family prefixes it shares a lineage edge with. */
  readonly tagsByPrefix: Map<string, string[]>;
}

/**
 * Fold the lineage signal into persisted lane-groups + validated edges +
 * per-family lineage tags. Edges referencing an unregistered family are dropped
 * with a `broken_edge` diagnostic (completeness — the 5b AC). No signal → an
 * empty fold (lineage simply not configured; NOT an error).
 */
function foldLineage(
  sig: LineageSignal | null,
  registered: ReadonlySet<string>,
  diagnostics: AtlasDiagnosticV1[],
): LineageFold {
  if (!sig) return { laneGroups: [], edges: [], tagsByPrefix: new Map() };

  const laneGroups: LaneGroupV1[] = sig.laneGroups.map((g) => ({
    id: g.id,
    title: g.title,
    kind: g.kind,
    lanes: g.lanes.map((l) => ({ id: l.id, title: l.title, families: [...l.families] })),
  }));

  const edges: LineageEdgeV1[] = [];
  const tagsByPrefix = new Map<string, string[]>();
  const addTag = (from: string, to: string) => {
    const list = tagsByPrefix.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    tagsByPrefix.set(from, list);
  };

  for (const e of sig.edges) {
    if (!registered.has(e.from) || !registered.has(e.to)) {
      const bad = !registered.has(e.from) ? e.from : e.to;
      diagnostics.push({
        code: "broken_edge",
        severity: "warn",
        message: `lineage edge ${e.from}→${e.to} references unregistered family "${bad}"`,
        prefix: bad,
      });
      continue; // drop the broken edge; do not tag with a phantom family
    }
    edges.push({ from: e.from, to: e.to, kind: e.kind });
    addTag(e.from, e.to);
    addTag(e.to, e.from);
  }

  for (const [prefix, list] of tagsByPrefix) tagsByPrefix.set(prefix, list.sort());
  return { laneGroups, edges, tagsByPrefix };
}

/** Group a family's work signals into one build per ticket, furthest-right state wins. */
function resolveBuilds(work: readonly WorkSignal[]): BuildV1[] {
  const byTicket = new Map<string, WorkSignal[]>();
  for (const w of work) {
    if (w.ticketId === null) continue; // unclassified work is not a family build
    const list = byTicket.get(w.ticketId) ?? [];
    list.push(w);
    byTicket.set(w.ticketId, list);
  }

  const builds: BuildV1[] = [];
  for (const [ticketId, group] of byTicket) {
    const state = resolveState(group);
    if (state === null) continue; // e.g. only a reverted ship → no live build
    const chosen = pickRepresentative(group, state);
    builds.push({
      ticketId,
      title: chosen.title ?? null,
      state,
      repo: chosen.repo,
      sha: chosen.sha ?? null,
      prNumber: chosen.prNumber ?? null,
      url: chosen.url ?? null,
      updatedAt: chosen.mtime ?? null,
    });
  }
  return builds.sort((a, b) => a.ticketId.localeCompare(b.ticketId));
}

/**
 * Furthest-right present state. Shipped counts only when the NEWEST shipped-or-
 * revert signal (by commit time) is a real ship — so ship→revert un-ships and
 * revert→re-ship re-ships (mirrors `deriveBoardState.isShippedActive`; the Board
 * stays the authoritative column engine).
 */
function resolveState(group: readonly WorkSignal[]): WorkState | null {
  const stages = new Set<WorkState>();
  for (const s of group) {
    if (s.state !== "shipped") stages.add(s.state);
  }
  if (isShippedActive(group.filter((s) => s.state === "shipped"))) stages.add("shipped");
  let best: WorkState | null = null;
  for (const s of stages) {
    if (best === null || STAGE_RANK[s] > STAGE_RANK[best]) best = s;
  }
  return best;
}

/** True when the latest shipped signal (by committer date) is NOT a revert. */
function isShippedActive(shipped: readonly WorkSignal[]): boolean {
  if (shipped.length === 0) return false;
  const newest = shipped.reduce((a, b) => (shippedTime(b) >= shippedTime(a) ? b : a));
  return newest.reverted !== true;
}

function shippedTime(s: WorkSignal): number {
  const t = s.mtime ? Date.parse(s.mtime) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Among the signals arguing for `state`, prefer one carrying the richest metadata. */
function pickRepresentative(group: readonly WorkSignal[], state: WorkState): WorkSignal {
  const candidates = group.filter((s) =>
    state === "shipped" ? s.state === "shipped" && s.reverted !== true : s.state === state,
  );
  const pool = candidates.length > 0 ? candidates : group;
  return (
    pool.find((s) => s.url || s.title) ??
    pool[0]
  );
}

function distinctRepos(work: readonly WorkSignal[]): string[] {
  const repos: string[] = [];
  for (const w of work) {
    if (!repos.includes(w.repo)) repos.push(w.repo);
  }
  return repos.sort();
}

function builtSummary(isRolling: boolean, builds: readonly BuildV1[]): string {
  const shipped = builds.filter((b) => b.state === "shipped").length;
  if (isRolling) return `${shipped} shipped · live`;
  if (builds.length === 0) return "no builds yet";
  return `${shipped}/${builds.length} shipped`;
}

// ---------------------------------------------------------------------------
// Domains (top-level grouping by L1 system)
// ---------------------------------------------------------------------------

function buildDomains(families: readonly FamilyV1[]): DomainV1[] {
  const byL1 = new Map<string, string[]>();
  for (const fam of families) {
    const bucket = byL1.get(fam.l1) ?? [];
    bucket.push(fam.prefix);
    byL1.set(fam.l1, bucket);
  }
  return [...byL1.entries()]
    .map(([id, prefixes]): DomainV1 => ({ id, title: id, families: prefixes.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Taxonomy (local to 5a; 5g migrates this + deriveBoardState to resolveGrouping)
// ---------------------------------------------------------------------------

function buildTaxonomy(taxa: readonly TaxonomySignal[]): Map<string, Taxon> {
  const map = new Map<string, Taxon>();
  for (const t of taxa) {
    const l2 = t.l2Subsystem ?? "General";
    map.set(t.prefix, {
      prefix: t.prefix,
      family: t.family,
      l1: t.l1System,
      l2,
      isGeneric: t.isGeneric,
      laneId: `${t.l1System}:${l2}`,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
