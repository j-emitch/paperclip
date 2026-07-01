/**
 * Canonical agent display order (CEO → COO → CTO → Librarian) — the single
 * UI-side source of truth, shared by every cockpit surface that orders agents
 * (the roster, the org constellation, the routines board).
 *
 * Declared here rather than value-importing the worker-side `OWNER_AGENTS` tuple
 * from the contract barrel: the browser import-boundary forbids a value import of
 * a contract module (it would drag zod into the bundle). This module carries NO
 * zod — a plain tuple + a pure ranking function — so it is safe to import from the
 * browser bundle and closes the prior triplication of this constant across
 * `agent-system-view`, `constellation-layout`, and `routines-view-model`.
 */

export const OWNER_AGENT_ORDER = ["CEO", "COO", "CTO", "Librarian"] as const;

/** Index of an agent in the canonical order; unknown agents sort last (caller adds an alpha tiebreak). */
export function agentRank(name: string): number {
  const i = OWNER_AGENT_ORDER.indexOf(name as (typeof OWNER_AGENT_ORDER)[number]);
  return i === -1 ? OWNER_AGENT_ORDER.length : i;
}
