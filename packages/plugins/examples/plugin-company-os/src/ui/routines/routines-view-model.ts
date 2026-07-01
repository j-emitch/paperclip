/**
 * Pure view-model for the Routines tab — folds a `RoutineHealthV1` into the
 * by-agent SLO groups + verdict tallies the TSX renders verbatim. Verdict tones
 * map onto the cockpit's shared status palette (fresh=green, stale=amber,
 * missing=red, never-ran=slate) so a routine's health reads the same hue the
 * board uses for review verdicts. Imports contract TYPES only — SSR-safe + unit
 * testable without a DOM.
 */

import type { RoutineHealthEntry, RoutineHealthV1, RoutineVerdict } from "../../contracts/index.js";
import { statusColors } from "../tokens.js";

/**
 * Canonical agent display order (CEO → COO → CTO → Librarian). The UI keeps its
 * own ordering constant rather than value-importing the worker-side
 * `OWNER_AGENTS` tuple — the contract surface must be imported type-only from the
 * browser bundle (the import-boundary), and routine `ownerAgent` is a free string
 * in the contract anyway, so ordering is a pure display concern.
 */
const OWNER_AGENT_ORDER = ["CEO", "COO", "CTO", "Librarian"] as const;

// The verdict label + tone maps are shared cockpit vocabulary (Routines + Home),
// so they live in `shared/verdict-labels`; re-exported here so this view-model's
// existing consumers (RoutinesView) keep importing them from one place.
export { VERDICT_LABELS, VERDICT_TONES } from "../shared/verdict-labels.js";

/** Worst-first severity — drives within-group sort + the summary order. */
export const VERDICT_SEVERITY: Record<RoutineVerdict, number> = {
  missing: 0,
  stale: 1,
  never_ran: 2,
  fresh: 3,
};

/** The order verdict chips appear in the summary bar (worst-first). */
export const VERDICT_ORDER: readonly RoutineVerdict[] = ["missing", "stale", "never_ran", "fresh"];

export function emptyVerdictCounts(): Record<RoutineVerdict, number> {
  return { fresh: 0, stale: 0, missing: 0, never_ran: 0 };
}

export interface AgentGroup {
  ownerAgent: string;
  routines: RoutineHealthEntry[];
  counts: Record<RoutineVerdict, number>;
}

export interface RoutinesView {
  groups: AgentGroup[];
  total: number;
  counts: Record<RoutineVerdict, number>;
  /** Share of routines that are `fresh` (0–100, rounded); 0 when none. */
  healthyPct: number;
}

/** Index of an agent in the canonical CEO→COO→CTO→Librarian order (unknown agents sort last, alpha). */
function agentRank(agent: string): number {
  const i = OWNER_AGENT_ORDER.indexOf(agent as (typeof OWNER_AGENT_ORDER)[number]);
  return i === -1 ? OWNER_AGENT_ORDER.length : i;
}

export function buildRoutinesView(health: RoutineHealthV1): RoutinesView {
  const counts = emptyVerdictCounts();
  const byAgent = new Map<string, RoutineHealthEntry[]>();
  let sloTotal = 0;

  for (const r of health.routines) {
    if (r.verdict !== null) {
      counts[r.verdict] += 1;
      sloTotal += 1;
    }
    const list = byAgent.get(r.ownerAgent);
    if (list) list.push(r);
    else byAgent.set(r.ownerAgent, [r]);
  }

  const groups: AgentGroup[] = [...byAgent.entries()]
    .map(([ownerAgent, routines]): AgentGroup => {
      const groupCounts = emptyVerdictCounts();
      for (const r of routines) {
        if (r.verdict !== null) groupCounts[r.verdict] += 1;
      }
      const sorted = [...routines].sort(
        (a, b) => severityOf(a.verdict) - severityOf(b.verdict) || a.displayName.localeCompare(b.displayName),
      );
      return { ownerAgent, routines: sorted, counts: groupCounts };
    })
    .sort((a, b) => agentRank(a.ownerAgent) - agentRank(b.ownerAgent) || a.ownerAgent.localeCompare(b.ownerAgent));

  const total = health.routines.length;
  return {
    groups,
    total,
    counts,
    healthyPct: sloTotal === 0 ? 0 : Math.round((counts.fresh / sloTotal) * 100),
  };
}

function severityOf(verdict: RoutineVerdict | null): number {
  return verdict === null ? 4 : VERDICT_SEVERITY[verdict];
}
