/**
 * Pure view-model for the Agents cockpit. Folds the persisted `AgentSystemV1`
 * into the ordered roster + severity-sorted diagnostics + the model-drift lookup
 * the pure view renders. Imports contract TYPES only (the browser import-boundary)
 * and re-declares the canonical agent order locally rather than value-importing
 * the worker-side `OWNER_AGENTS` tuple — ordering is a pure display concern.
 */

import type {
  AgentCardV1,
  AgentDiagnosticV1,
  AgentDutyV1,
  AgentSystemV1,
  AgentSystemVitalsV1,
  HandoffEdgeV1,
  OverlapEdgeV1,
} from "../../contracts/index.js";
import { agentRank } from "../shared/agent-order.js";

// Canonical agent order lives in one shared UI-side module; re-export it so
// existing consumers of `agentRank` via this view-model keep working.
export { agentRank };

const SEVERITY_ORDER: Record<AgentDiagnosticV1["severity"], number> = { warn: 0, info: 1 };

export interface AgentSystemVm {
  vitals: AgentSystemVitalsV1;
  /** Roster in canonical order. */
  agents: AgentCardV1[];
  /** agentKeys carrying a `model_drift` diagnostic (drives the roster drift chip). */
  agentsWithModelDrift: ReadonlySet<string>;
  /** Diagnostics worst-first (warn before info), stable within a severity. */
  diagnostics: AgentDiagnosticV1[];
  warnCount: number;
  infoCount: number;
  overlaps: OverlapEdgeV1[];
  handoffs: HandoffEdgeV1[];
  handoffMismatchCount: number;
  hasAnyData: boolean;
}

export function buildAgentSystemVm(system: AgentSystemV1): AgentSystemVm {
  const agents = [...system.agents].sort(
    (a, b) => agentRank(a.displayName) - agentRank(b.displayName) || a.agentKey.localeCompare(b.agentKey),
  );
  const agentsWithModelDrift = new Set<string>(
    system.diagnostics
      .filter((d): d is AgentDiagnosticV1 & { agentKey: string } => d.code === "model_drift" && d.agentKey !== null)
      .map((d) => d.agentKey),
  );
  const diagnostics = [...system.diagnostics].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
  const warnCount = diagnostics.filter((d) => d.severity === "warn").length;

  return {
    vitals: system.vitals,
    agents,
    agentsWithModelDrift,
    diagnostics,
    warnCount,
    infoCount: diagnostics.length - warnCount,
    overlaps: system.overlaps,
    handoffs: system.handoffs,
    handoffMismatchCount: system.handoffs.filter((h) => !h.consistent).length,
    hasAnyData: agents.length > 0,
  };
}

/**
 * Sort + defensively de-duplicate an agent's duties by id. The projection
 * (`deriveAgentSystem.dutiesFor`) already collapses a declared duty and an
 * embedded-routine of the same id at the SOURCE (embedded-routine wins), so the
 * persisted contract is duplicate-free; this view pass is idempotent
 * belt-and-suspenders against a future producer regression, and applies the
 * label sort the roster renders.
 */
export function dutiesForDisplay(agent: AgentCardV1): AgentDutyV1[] {
  const byId = new Map<string, AgentDutyV1>();
  for (const duty of agent.duties) {
    const existing = byId.get(duty.id);
    if (!existing || (existing.kind === "duty" && duty.kind === "embedded-routine")) byId.set(duty.id, duty);
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Monthly budget in cents → a compact "$170/mo" (whole) / "$25.50/mo" (fractional) / "—" (null). */
export function formatBudget(cents: number | null): string {
  if (cents === null) return "—";
  const dollars = cents / 100;
  const rendered = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return "$" + rendered + "/mo";
}
