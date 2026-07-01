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
  isTaxonomySignal,
  isWorkSignal,
  type DocSignal,
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

  // A family per registered prefix (show 0-count families, like the Board's rows).
  const families: FamilyV1[] = [];
  for (const taxon of [...taxonomy.values()].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    const famWork = workByPrefix.get(taxon.prefix) ?? [];
    const famDocs = docsByPrefix.get(taxon.prefix) ?? [];
    families.push(buildFamily(taxon, famWork, famDocs));
  }

  // Work whose prefix parsed but isn't registered → an unknown-prefix diagnostic
  // (the Board routes these to its Ops lane; the Atlas surfaces them on the rail).
  const registered = new Set(taxonomy.keys());
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
    laneGroups: [], // 5b — lineage layer
    edges: [], // 5b — lineage edges
    diagnostics,
    sourceDiagnostics: diagnosticsFromFreshness(sources),
  };
}

// ---------------------------------------------------------------------------
// Family assembly
// ---------------------------------------------------------------------------

function buildFamily(taxon: Taxon, work: readonly WorkSignal[], docs: readonly DocSignal[]): FamilyV1 {
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
    lifecycle: deriveLifecycle(taxon.prefix, docs, work),
    builtPct: total === 0 ? 0 : Math.round((shipped / total) * 100),
    builtSummary: builtSummary(isRolling, builds),
    builds,
    tickets: [], // 5c — LYC routing
    lineageTags: [], // 5b — lineage edges
  };
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
 * Furthest-right present state. Shipped counts only when a non-reverted shipped
 * signal exists (a lightweight echo of the Board's revert handling — the Board
 * stays the authoritative column engine).
 */
function resolveState(group: readonly WorkSignal[]): WorkState | null {
  const stages = new Set<WorkState>();
  for (const s of group) {
    if (s.state !== "shipped") stages.add(s.state);
  }
  if (group.some((s) => s.state === "shipped" && s.reverted !== true)) stages.add("shipped");
  let best: WorkState | null = null;
  for (const s of stages) {
    if (best === null || STAGE_RANK[s] > STAGE_RANK[best]) best = s;
  }
  return best;
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
