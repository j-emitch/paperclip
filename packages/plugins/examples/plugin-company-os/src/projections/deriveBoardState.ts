/**
 * `deriveBoardState` — the auto-Kanban projection. Pure fold of WorkSignals +
 * ReviewSignals + TaxonomySignals + source freshness into `BoardStateV1`. This
 * is where the spec §6 rules live: column = furthest-right stage with a live
 * signal (reverts un-ship), chip metadata = the strongest-precedence signal for
 * that column, lanes/rows from the registry taxonomy, In-review review-state
 * joined from head-SHA-current reports, and everything unresolvable lands in the
 * Ops lane with an actionable reason. No I/O — the UI renders this verbatim.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  isReviewSignal,
  isTaxonomySignal,
  isWorkSignal,
  type ReviewSignal,
  type TaxonomySignal,
  type WorkSignal,
} from "../contracts/signals.js";
import {
  BOARD_STATE_SCHEMA_VERSION,
  BOARD_COLUMNS,
  type BoardStateV1,
  type Chip,
  type Lane,
  type PrefixRow,
  type UnclassifiedChip,
} from "../contracts/board-state.js";
import type {
  ChipReviewState,
  UnclassifiedReason,
  WorkSignalPrecedence,
  WorkState,
} from "../contracts/vocab.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

/** Stage order — the furthest-right present stage wins the column. */
const STAGE_RANK: Record<WorkState, number> = { next_up: 0, in_progress: 1, in_review: 2, shipped: 3 };

/** Precedence strength — lowest index is strongest (spec §6 ladder). */
const PRECEDENCE_RANK: Record<WorkSignalPrecedence, number> = {
  branch_path: 0,
  pr_scope: 1,
  commit_scope: 2,
  spec_frontmatter: 3,
  worktree_meta: 4,
  none: 5,
};

const OPS_LANE_ID = "Ops";

interface Taxon {
  readonly prefix: string;
  readonly family: string;
  readonly l1System: string;
  readonly l2Subsystem: string;
  readonly isGeneric: boolean;
  readonly laneId: string;
}

export function deriveBoardState(bundle: SignalBundle, nowMs: number): BoardStateV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const work = signals.filter(isWorkSignal);
  const reviews = signals.filter(isReviewSignal);
  const taxonomy = buildTaxonomy(signals.filter(isTaxonomySignal));

  const lanes = new Map<string, Lane>();
  const rows = new Map<string, PrefixRow>();
  // Seed every registered prefix as a row (show 0-count rows) + its lane.
  for (const t of taxonomy.values()) {
    ensureLane(lanes, t.laneId, t.l1System, t.l2Subsystem);
    if (!rows.has(t.prefix)) {
      rows.set(t.prefix, { prefix: t.prefix, family: t.family, laneId: t.laneId, isGeneric: t.isGeneric, repos: [] });
    }
  }

  const chips: Chip[] = [];
  const unclassified: UnclassifiedChip[] = [];

  // Group work signals by ticket id; null-ticket signals are unclassified.
  const byTicket = new Map<string, WorkSignal[]>();
  for (const w of work) {
    if (w.ticketId === null) {
      unclassified.push(unclassifiedFromSignal(w));
      continue;
    }
    const list = byTicket.get(w.ticketId) ?? [];
    list.push(w);
    byTicket.set(w.ticketId, list);
  }

  for (const [ticketId, group] of byTicket) {
    const prefix = group[0].prefix;
    const taxon = prefix ? taxonomy.get(prefix) : undefined;
    if (!prefix || !taxon) {
      // Parsed a ticket id but its prefix isn't registered → Ops lane, nudge.
      unclassified.push({
        id: ticketId,
        repo: group[0].repo,
        reason: "unknown_prefix" satisfies UnclassifiedReason,
        evidence: group[0].evidence,
        prefix: prefix ?? null,
        hint: prefix ? `register "${prefix}" in company/config/prefix-registry.json` : null,
      });
      continue;
    }

    const column = resolveColumn(group);
    if (column === null) continue; // e.g. only a reverted ship → no live placement

    const chosen = strongestForColumn(group, column);
    ensureLane(lanes, taxon.laneId, taxon.l1System, taxon.l2Subsystem);
    addRepoToRow(rows, taxon, chosen.repo);

    chips.push({
      id: ticketId,
      prefix,
      laneId: taxon.laneId,
      column,
      title: chosen.title ?? null,
      repo: chosen.repo,
      precedence: chosen.precedence,
      sha: chosen.sha ?? null,
      prNumber: chosen.prNumber ?? null,
      url: chosen.url ?? null,
      updatedAt: chosen.mtime ?? null,
      reviewState: column === "in_review" ? resolveReviewState(chosen, reviews) : null,
    });
  }

  if (unclassified.length > 0) ensureOpsLane(lanes);

  const sources = aggregateSourceFreshness(bundle);
  return {
    schemaVersion: BOARD_STATE_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    sources,
    lanes: [...lanes.values()].sort(laneSort),
    rows: [...rows.values()].sort((a, b) => a.laneId.localeCompare(b.laneId) || a.prefix.localeCompare(b.prefix)),
    columns: [...BOARD_COLUMNS],
    chips: chips.sort((a, b) => a.laneId.localeCompare(b.laneId) || a.id.localeCompare(b.id)),
    diagnostics: diagnosticsFromFreshness(sources),
    unclassified: unclassified.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ---------------------------------------------------------------------------
// Taxonomy + lanes
// ---------------------------------------------------------------------------

function buildTaxonomy(taxa: readonly TaxonomySignal[]): Map<string, Taxon> {
  const map = new Map<string, Taxon>();
  for (const t of taxa) {
    const l2 = t.l2Subsystem ?? "General";
    map.set(t.prefix, {
      prefix: t.prefix,
      family: t.family,
      l1System: t.l1System,
      l2Subsystem: l2,
      isGeneric: t.isGeneric,
      laneId: `${t.l1System}:${l2}`,
    });
  }
  return map;
}

function ensureLane(lanes: Map<string, Lane>, laneId: string, l1: string, l2: string): void {
  if (lanes.has(laneId)) return;
  lanes.set(laneId, {
    id: laneId,
    l1System: l1,
    l2Subsystem: l2,
    title: `${l1} · ${l2}`,
    isOps: false,
    collapsedByDefault: false,
  });
}

function ensureOpsLane(lanes: Map<string, Lane>): void {
  if (lanes.has(OPS_LANE_ID)) return;
  lanes.set(OPS_LANE_ID, {
    id: OPS_LANE_ID,
    l1System: "Ops",
    l2Subsystem: "Unclassified / Ops",
    title: "Unclassified / Ops",
    isOps: true,
    collapsedByDefault: true,
  });
}

/** Ops lane sorts last; otherwise alphabetical by lane id. */
function laneSort(a: Lane, b: Lane): number {
  if (a.isOps !== b.isOps) return a.isOps ? 1 : -1;
  return a.id.localeCompare(b.id);
}

function addRepoToRow(rows: Map<string, PrefixRow>, taxon: Taxon, repo: string): void {
  const row = rows.get(taxon.prefix);
  if (!row) {
    rows.set(taxon.prefix, { prefix: taxon.prefix, family: taxon.family, laneId: taxon.laneId, isGeneric: taxon.isGeneric, repos: [repo] });
    return;
  }
  if (!row.repos.includes(repo)) row.repos.push(repo);
}

// ---------------------------------------------------------------------------
// Column + precedence resolution
// ---------------------------------------------------------------------------

/** The furthest-right stage with a live signal; null when nothing places (e.g. only a reverted ship). */
function resolveColumn(group: readonly WorkSignal[]): WorkState | null {
  const stages = new Set<WorkState>();
  for (const s of group) {
    if (s.state === "shipped") {
      if (!s.reverted) stages.add("shipped"); // a revert removes the ship
    } else {
      stages.add(s.state);
    }
  }
  let best: WorkState | null = null;
  for (const s of stages) {
    if (best === null || STAGE_RANK[s] > STAGE_RANK[best]) best = s;
  }
  return best;
}

/** Among the signals arguing for `column`, the strongest-precedence one (chip metadata source). */
function strongestForColumn(group: readonly WorkSignal[], column: WorkState): WorkSignal {
  const candidates = group.filter((s) =>
    column === "shipped" ? s.state === "shipped" && !s.reverted : s.state === column,
  );
  return candidates.reduce((best, s) =>
    PRECEDENCE_RANK[s.precedence] < PRECEDENCE_RANK[best.precedence] ? s : best,
  );
}

function unclassifiedFromSignal(w: WorkSignal): UnclassifiedChip {
  return {
    id: `${w.repo}:${w.evidence}`,
    repo: w.repo,
    reason: w.unclassifiedReason ?? "bad_branch_format",
    evidence: w.evidence,
    prefix: w.prefix ?? null,
    hint: w.prefix ? `register "${w.prefix}" in company/config/prefix-registry.json` : null,
  };
}

// ---------------------------------------------------------------------------
// In-review review-state join (head-SHA-current reports only)
// ---------------------------------------------------------------------------

function resolveReviewState(chip: WorkSignal, reviews: readonly ReviewSignal[]): ChipReviewState {
  if (!chip.sha) return "unknown"; // can't head-SHA-match without the head sha
  const current = reviews.filter((r) => r.repo === chip.repo && r.sha === chip.sha);
  return current.length > 0 ? "reviewed" : "unknown";
}
