/**
 * `deriveBuildAtlas` — the Build Atlas projection (spec §5, COS-5). A pure fold
 * of WorkSignals + DocSignals + TaxonomySignals into `BuildAtlasV1`: every
 * registered spec-prefix family (shown 0-count, like the Board's rows) becomes a
 * card carrying a lifecycle stepper (`deriveLifecycle`, decoupled from built-%),
 * a built bar, and its in-flight builds. Families group into domains (by L1
 * system).
 *
 * 5a populates families + domains + lifecycle + builds; the lineage lane-groups
 * (5b) and routed LYC tickets (5c) fold in later. Grouping (5g) runs through the
 * shared `buildPrefixGrouping` resolver (`contracts/grouping.ts`) — the same
 * prefix lens `deriveBoardState` uses — with `isRolling` sourced from the
 * registry. No I/O — the UI renders this verbatim.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  isDocSignal,
  isLineageSignal,
  isTaxonomySignal,
  isTicketSignal,
  isWorkSignal,
  type DocSignal,
  type LineageSignal,
  type TicketSignal,
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
  type TicketRefV1,
} from "../contracts/build-atlas.js";
import { prefixOf } from "../contracts/ticket-id.js";
import { buildPrefixGrouping, type GroupingEntry } from "../contracts/grouping.js";
import type { WorkState } from "../contracts/vocab.js";
import { deriveLifecycle } from "./deriveLifecycle.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

/** Furthest-right stage wins the build's column (mirrors the Board's STAGE_RANK). */
const STAGE_RANK: Record<WorkState, number> = { next_up: 0, in_progress: 1, in_review: 2, shipped: 3 };

export function deriveBuildAtlas(bundle: SignalBundle, nowMs: number): BuildAtlasV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const work = signals.filter(isWorkSignal);
  const docs = signals.filter(isDocSignal);
  // The shared prefix lens (COS-5g) — one resolver for Board + Atlas; the rolling
  // flag now rides on each entry, sourced from the registry.
  const taxonomy = buildPrefixGrouping(signals.filter(isTaxonomySignal));

  const workByPrefix = groupBy(work, (w) => w.prefix);
  const docsByPrefix = groupBy(docs, (d) => d.prefix);
  const diagnostics: AtlasDiagnosticV1[] = [];

  // Lineage fold. `LineageSource` emits exactly ONE company-scoped whole-graph
  // signal per derive, so the last one in bundle order is the graph (codex 5b P2:
  // "last", not "freshest" — the guarantee is single-signal, asserted in a test).
  const registered = new Set(taxonomy.keys());
  const lineageSig = signals.filter(isLineageSignal).at(-1) ?? null;
  const { laneGroups, edges, tagsByPrefix } = foldLineage(lineageSig, registered, diagnostics);

  // LYC three-tier routing (spec §5.5): routine_execution collapses to one
  // Meta·Routines chip per routine key, issue_productivity_review is dropped,
  // manual routes to the family it references (extras → lineage tags) or to the
  // Meta·Ops bucket when it names none. done/cancelled are excluded from active.
  const tickets = signals.filter(isTicketSignal);
  const routing = routeTickets(tickets, registered, diagnostics);

  // A family per registered prefix (show 0-count families, like the Board's rows).
  const families: FamilyV1[] = [];
  for (const taxon of [...taxonomy.values()].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    const famWork = workByPrefix.get(taxon.prefix) ?? [];
    const famDocs = docsByPrefix.get(taxon.prefix) ?? [];
    const mergedTags = mergeTags(
      tagsByPrefix.get(taxon.prefix) ?? [],
      routing.extraTagsByPrefix.get(taxon.prefix) ?? [],
    );
    const famTickets = (routing.ticketsByPrefix.get(taxon.prefix) ?? []).sort((a, b) =>
      a.identifier.localeCompare(b.identifier),
    );
    families.push(buildFamily(taxon, famWork, famDocs, mergedTags, famTickets));
  }

  // Orphan-family completeness: a registered family in NO lane. Gated on the
  // lineage SIGNAL being present (codex 5b P1) — a graph with a non-empty `edges`
  // but empty `laneGroups` is valid to the loader, so gating on laneGroups.length
  // would wrongly suppress every orphan. No signal = "lineage not configured".
  if (lineageSig) {
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
  // Ticket-referenced unregistered prefixes join the SAME channel (deduped, one
  // diagnostic per prefix across work + tickets — codex-5c-A-P2).
  for (const p of routing.unknownRefPrefixes) unknownPrefixes.add(p);
  for (const prefix of [...unknownPrefixes].sort()) {
    diagnostics.push({
      code: "unknown_prefix",
      severity: "warn",
      message: `work references unregistered prefix "${prefix}" — register it in company/config/prefix-registry.json`,
      prefix,
    });
  }

  // The synthetic Meta family holds the collapsed routine chips + unrouted (ops)
  // tickets — the "one new Meta·Routines lane" (spec §6.3), a single clearly-
  // labeled bucket rather than a dumping-ground on a real family. Appended AFTER
  // the orphan/unknown checks so it is never itself flagged as orphaned (it is not
  // a registered family), and picked up by buildDomains under the Company domain.
  // Emitted whenever the ticket source is participating (show-0: the Meta lane
  // renders with explicit 0-counts even if everything routed to real families) —
  // but NOT when there are no tickets at all (5a/5b backward-compat).
  if (tickets.length > 0) {
    families.push(buildMetaFamily(routing.metaTickets));
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
  taxon: GroupingEntry,
  work: readonly WorkSignal[],
  docs: readonly DocSignal[],
  lineageTags: readonly string[],
  tickets: readonly TicketRefV1[],
): FamilyV1 {
  const builds = resolveBuilds(work);
  const isRolling = taxon.isRolling;
  const shipped = builds.filter((b) => b.state === "shipped").length;
  const total = builds.length;
  const repos = distinctRepos(work);
  // C2 (§2.3 spine): the family's canonical spec/plan doc metadata — newest
  // MAIN-checkout doc of each type wins (worktree copies are in-flight drafts,
  // not canon; used only when no main copy exists at all).
  const spec = newestDocOfType(docs, "spec");
  const plan = newestDocOfType(docs, "plan");
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
    specStatus: spec?.status ?? null,
    specUpdatedAt: docTouchedAt(spec),
    planStatus: plan?.status ?? null,
    planUpdatedAt: docTouchedAt(plan),
    description: spec?.description ?? plan?.description ?? null, // ?? also coalesces pre-v2 cached signals' undefined
    builtPct: total === 0 ? 0 : Math.round((shipped / total) * 100),
    builtSummary: builtSummary(isRolling, builds),
    builds,
    tickets: [...tickets], // 5c — routed LYC tickets (route: "family")
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

  // Lane family refs are validated against the registry too (codex 5b P1): a
  // typo'd family in a lane is dropped with a broken_edge diagnostic rather than
  // silently surviving into the persisted lane-groups (the .mjs loader is a pure
  // shape validator and deliberately does NOT cross-check the registry).
  const laneGroups: LaneGroupV1[] = sig.laneGroups.map((g) => ({
    id: g.id,
    title: g.title,
    kind: g.kind,
    lanes: g.lanes.map((l) => ({
      id: l.id,
      title: l.title,
      families: l.families.filter((f) => {
        if (registered.has(f)) return true;
        diagnostics.push({
          code: "broken_edge",
          severity: "warn",
          message: `lane "${l.id}" references unregistered family "${f}"`,
          prefix: f,
        });
        return false;
      }),
    })),
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

// ---------------------------------------------------------------------------
// LYC three-tier routing (5c) — TicketSignals → routed TicketRefV1s (spec §5.5)
// ---------------------------------------------------------------------------

/** The synthetic Meta family's prefix — holds routine + ops chips. */
const META_PREFIX = "META";

/** Statuses excluded from the active Atlas (kept only for a future shipped rollup). */
const DONE_STATUSES = new Set(["done", "cancelled"]);

interface TicketRouting {
  /** prefix → tickets routed to that registered family (route: "family"). */
  readonly ticketsByPrefix: Map<string, TicketRefV1[]>;
  /** prefix → extra referenced families a multi-family ticket contributes as lineage tags. */
  readonly extraTagsByPrefix: Map<string, string[]>;
  /** Collapsed routine chips (route: "routine") + unrouted manual (route: "ops"). */
  readonly metaTickets: TicketRefV1[];
  /** Referenced-but-unregistered prefixes — folded into the unified unknown_prefix channel. */
  readonly unknownRefPrefixes: ReadonlySet<string>;
}

/**
 * The three-tier fold. Tier 1 (routine_execution) collapses to one Meta·Routines
 * chip per routine key; tier 2 (issue_productivity_review) is dropped; tier 3
 * (manual + any other work origin) routes to the first registered family it
 * references — extras become that family's lineage tags — or to the Meta·Ops
 * bucket (with an `unrouted_ticket` diagnostic) when it references none. The
 * done/cancelled exclusion is a MANUAL work-backlog filter (spec §5.5): it never
 * touches routine firings (which count every run) nor other origins.
 */
function routeTickets(
  tickets: readonly TicketSignal[],
  registered: ReadonlySet<string>,
  diagnostics: AtlasDiagnosticV1[],
): TicketRouting {
  const ticketsByPrefix = new Map<string, TicketRefV1[]>();
  const extraTagsByPrefix = new Map<string, string[]>();
  const metaTickets: TicketRefV1[] = [];
  const unknownRefPrefixes = new Set<string>();
  const routineFirings: TicketSignal[] = [];

  const routeByFamily = (t: TicketSignal) => {
    const ownPrefix = prefixOf(t.identifier);
    // Surface referenced-but-unregistered prefixes (typo / registry gap) via the
    // unified unknown_prefix channel — even when a registered candidate exists, so a
    // `MPT-1` typo alongside a real `COS-1` is not silently swallowed (codex-5c-A-P2).
    for (const p of t.referencedFamilies) {
      if (p !== ownPrefix && !registered.has(p)) unknownRefPrefixes.add(p);
    }
    const candidates = t.referencedFamilies.filter((p) => p !== ownPrefix && registered.has(p));
    if (candidates.length === 0) {
      metaTickets.push(ticketRefFrom(t, "ops"));
      diagnostics.push({
        code: "unrouted_ticket",
        severity: "warn",
        message: `ticket ${t.identifier} references no registered family — parked in Meta·Ops`,
        prefix: null,
      });
      return;
    }
    const target = candidates[0];
    const list = ticketsByPrefix.get(target) ?? [];
    list.push(ticketRefFrom(t, "family"));
    ticketsByPrefix.set(target, list);
    for (const extra of candidates.slice(1)) addExtraTag(extraTagsByPrefix, target, extra);
  };

  for (const t of tickets) {
    if (t.originKind === "issue_productivity_review") continue; // tier 2 — scan noise, dropped
    if (t.originKind === "routine_execution") {
      routineFirings.push(t); // tier 1 — collapsed below; every firing counts as a run
      continue;
    }
    // tier 3 — manual (or any other work origin). done/cancelled excludes the
    // completed MANUAL backlog only (spec §5.5) — it is gated on `manual` so it can
    // never drop another origin's tickets, and routine firings are handled above.
    if (t.originKind === "manual" && DONE_STATUSES.has((t.status ?? "").trim().toLowerCase())) continue;
    routeByFamily(t);
  }

  metaTickets.push(...collapseRoutines(routineFirings));
  metaTickets.sort((a, b) => a.identifier.localeCompare(b.identifier));
  return { ticketsByPrefix, extraTagsByPrefix, metaTickets, unknownRefPrefixes };
}

function addExtraTag(map: Map<string, string[]>, prefix: string, tag: string): void {
  const list = map.get(prefix) ?? [];
  if (!list.includes(tag)) list.push(tag);
  map.set(prefix, list);
}

/** Union two tag lists (lineage-derived + ticket-derived), deduped + sorted. */
function mergeTags(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

/** One persisted TicketRefV1 from a signal, with its resolved route. */
function ticketRefFrom(t: TicketSignal, route: TicketRefV1["route"]): TicketRefV1 {
  return {
    identifier: t.identifier,
    title: t.title === "" ? null : t.title,
    status: t.status,
    priority: t.priority,
    originKind: t.originKind,
    route,
  };
}

/**
 * Collapse routine_execution firings into ONE chip per routine definition, keyed
 * by `parentId` (fallback: normalized title + `assigneeAgentId`). The chip carries
 * the firing count + last-run date; a routine that fired N times becomes one row.
 */
function collapseRoutines(firings: readonly TicketSignal[]): TicketRefV1[] {
  const byKey = new Map<string, TicketSignal[]>();
  for (const t of firings) {
    const key = t.parentId ?? `${normalizeRoutineTitle(t.title)}|${t.assigneeAgentId ?? ""}`;
    const list = byKey.get(key) ?? [];
    list.push(t);
    byKey.set(key, list);
  }

  const chips: TicketRefV1[] = [];
  for (const [key, group] of byKey) {
    const rep = group.reduce((a, b) => (firingTime(b) >= firingTime(a) ? b : a));
    const count = group.length;
    const last = rep.mtime ? ` · last ${rep.mtime.slice(0, 10)}` : "";
    const base = rep.title === "" ? rep.identifier : rep.title;
    chips.push({
      // A STABLE synthetic identifier from the routine key — NOT the latest firing's
      // id (which churns + reorders the row as new firings arrive; codex-5c-A-P2).
      identifier: `routine:${key}`,
      title: `${base} · ${count} run${count === 1 ? "" : "s"}${last}`,
      status: null,
      priority: null,
      originKind: "routine_execution",
      route: "routine",
    });
  }
  return chips.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

function firingTime(t: TicketSignal): number {
  const ms = t.mtime ? Date.parse(t.mtime) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Strip dates / issue-numbers / redundant whitespace so daily firings share a key. */
function normalizeRoutineTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/#\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The synthetic Meta family — the Meta·Routines lane + Ops bucket in one card. */
function buildMetaFamily(tickets: readonly TicketRefV1[]): FamilyV1 {
  const routines = tickets.filter((t) => t.route === "routine").length;
  const ops = tickets.filter((t) => t.route === "ops").length;
  const sorted = [...tickets].sort((a, b) => a.identifier.localeCompare(b.identifier));
  return {
    prefix: META_PREFIX,
    name: "Meta · Routines & Ops",
    l1: "Company",
    l2: "Meta",
    domain: "Company",
    laneId: "Company:Meta",
    repos: ["company"],
    isGeneric: false,
    isRolling: true,
    // Operational bucket — not a spec-driven build; the stepper reads "live", not
    // a completion path, and builtPct stays 0 (nothing to "build"). The summary
    // carries the real signal (routine + unrouted counts).
    lifecycle: { spec: "done", plan: "done", build: "active", prod: "active", planState: "ok" },
    specStatus: null,
    specUpdatedAt: null,
    planStatus: null,
    planUpdatedAt: null,
    description: null,
    builtPct: 0,
    builtSummary: `${routines} routine${routines === 1 ? "" : "s"} · ${ops} unrouted`,
    builds: [],
    tickets: sorted,
    lineageTags: [],
  };
}

/** Newest doc of a type — main-checkout copies win; worktree-only is a fallback. */
function newestDocOfType(docs: readonly DocSignal[], docType: "spec" | "plan"): DocSignal | null {
  const ofType = docs.filter((d) => d.docType === docType);
  const main = ofType.filter((d) => d.checkoutId === "main");
  const pool = main.length > 0 ? main : ofType;
  let newest: DocSignal | null = null;
  for (const d of pool) {
    if (newest === null || docTouchedAt(d)! > docTouchedAt(newest)!) newest = d;
  }
  return newest;
}

/** A doc's last-touch stamp: frontmatter `last_updated` (?? `date`) wins over mtime. */
function docTouchedAt(doc: DocSignal | null | undefined): string | null {
  if (!doc) return null;
  return doc.lastUpdated ?? doc.mtime ?? null; // pre-v2 cached signals may lack lastUpdated entirely
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
