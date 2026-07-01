/**
 * Golden `AgentSystemV1` fixtures for the Agents cockpit UI. Built through the
 * REAL `deriveAgentSystem` fold (not hand-authored) so vitals, diagnostics,
 * handoffs, and overlaps are always internally consistent with the agents — the
 * view is tested against contract-valid data on the true derivation path.
 *
 * The `golden` scenario deliberately exercises every region: fresh / missing /
 * stale / embedded(null) verdicts, a resolved duty overlap (company/docs →
 * Librarian), a consistent handoff (CEO↔CTO), an inconsistent one (COO→Librarian
 * → a handoff_mismatch warn), and four claude-model agents (→ four model_drift
 * info diagnostics).
 */

import { deriveAgentSystem } from "../../../src/projections/deriveAgentSystem.js";
import { agentSignal, artifact, bundleOf, routine, NOW } from "../../fixtures/signals.js";
import type { AgentSystemV1 } from "../../../src/contracts/agent-system.js";

/** The fixture clock — matches the projection golden's `NOW` (2026-06-23T12:00Z). */
export const AGENTS_NOW = NOW;

export function goldenAgentSystem(): AgentSystemV1 {
  return deriveAgentSystem(
    bundleOf([
      agentSignal("ceo", {
        displayName: "CEO",
        role: "ceo",
        model: "claude-opus-4-8",
        budgetMonthlyCents: 3000,
        canCreateAgents: true,
        reportsTo: null,
        handsOffTo: ["CTO"],
        receivesFrom: ["CTO"],
        duties: [{ id: "strategy", surface: "company/reports/strategy" }],
      }),
      agentSignal("coo", {
        displayName: "COO",
        role: "pm",
        model: "claude-opus-4-8",
        budgetMonthlyCents: 3000,
        reportsTo: "CEO",
        // Hands off to the Librarian, who does NOT list COO in receivesFrom → mismatch.
        handsOffTo: ["Librarian"],
        receivesFrom: ["CEO"],
        duties: [
          { id: "process-health", surface: "company/reports/health" },
          { id: "doc-currency", surface: "company/docs" },
        ],
      }),
      agentSignal("cto", {
        displayName: "CTO",
        role: "cto",
        model: "claude-opus-4-8",
        budgetMonthlyCents: 8000,
        reportsTo: "CEO",
        handsOffTo: ["CEO"],
        receivesFrom: ["CEO"],
        duties: [
          { id: "daily-standup", surface: "company/reports/standup" },
          { id: "technical-docs", surface: "company/docs/reference" },
        ],
      }),
      agentSignal("librarian", {
        displayName: "Librarian",
        role: "librarian",
        model: "claude-opus-4-8",
        budgetMonthlyCents: 3000,
        reportsTo: "CEO",
        maxTurnsPerRun: 500,
        // receivesFrom defaults to ["CEO"] — deliberately not COO, so COO→Librarian is inconsistent.
        duties: [{ id: "wiki-maintenance", surface: "company/library/topics" }],
      }),
      routine("weekly-strategic-summary", "weekly", "company/reports/strategy/*.md", {
        ownerAgent: "CEO",
        displayName: "Weekly Strategic Summary",
        freshnessKind: "artifact",
      }),
      routine("daily-health-scan", "daily", "company/reports/health/*.md", {
        ownerAgent: "COO",
        displayName: "Daily Health Scan",
        freshnessKind: "artifact",
        lastRunAt: "2026-06-23T11:00:00.000Z",
      }),
      routine("daily-standup", "daily", "company/reports/standup/*.md", {
        ownerAgent: "CTO",
        displayName: "Daily Standup",
        freshnessKind: "artifact",
      }),
      routine("wiki-maintenance", "daily scan", "", {
        ownerAgent: "Librarian",
        displayName: "Wiki Maintenance",
        freshnessKind: "embedded",
      }),
      artifact("reports/strategy/2026-06-23.md", {
        repo: "company",
        mtime: "2026-06-23T10:00:00.000Z",
        createdBy: "CEO",
      }),
      artifact("reports/standup/2026-06-22.md", {
        repo: "company",
        mtime: "2026-06-22T00:00:00.000Z",
        createdBy: "CTO",
      }),
    ]),
    AGENTS_NOW,
  );
}

/** The zero-state: no agents configured yet (cold company). */
export function emptyAgentSystem(): AgentSystemV1 {
  return deriveAgentSystem(bundleOf([]), AGENTS_NOW);
}
