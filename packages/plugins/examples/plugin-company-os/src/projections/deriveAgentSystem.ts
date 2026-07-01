/**
 * `deriveAgentSystem` — pure fold for the COS-1R Agents cockpit. It joins
 * configured agents to sidecar routines, reuses the routine-health fold for SLO
 * math, derives handoff/overlap coordination, and emits a compact diagnostics
 * rail. No taxonomy lens: the agent system is company-global.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  AGENT_SYSTEM_SCHEMA_VERSION,
  type AgentCardV1,
  type AgentDiagnosticV1,
  type AgentDutyV1,
  type AgentSystemV1,
  type HandoffEdgeV1,
  type OverlapEdgeV1,
  type RoutineSloEntryV1,
  type VerdictCountsV1,
} from "../contracts/agent-system.js";
import { isAgentSignal, isRoutineSignal, type AgentSignal, type RoutineSignal } from "../contracts/signals.js";
import { OWNER_AGENTS, type OwnerAgent, type RoutineVerdict } from "../contracts/vocab.js";
import { deriveRoutineHealth } from "./deriveRoutineHealth.js";
import { aggregateSourceFreshness, isoFrom } from "./_shared.js";

const VERDICT_SEVERITY: Record<RoutineVerdict, number> = {
  missing: 0,
  stale: 1,
  never_ran: 2,
  fresh: 3,
};

interface OverlapResolution {
  readonly surfaces: readonly string[];
  readonly proposedOwner: OwnerAgent;
  readonly recommendation: string;
}

const OVERLAP_RESOLUTIONS: readonly OverlapResolution[] = [
  {
    surfaces: ["company/CONTEXT.md", "company/decisions", "company/archive/context-decisions"],
    proposedOwner: "Librarian",
    recommendation:
      "Librarian owns detection/proposal mechanics; CEO consumes decision quality at strategy level; COO audits process compliance only.",
  },
  {
    surfaces: ["company/docs", "company/library/topics", "company/docs/reference"],
    proposedOwner: "Librarian",
    recommendation:
      "Librarian owns content freshness and wiki updates; COO owns process trend reporting when freshness slips repeatedly.",
  },
  {
    surfaces: [
      "company/config/paperclip/agents",
      "company/docs/company-os/06-agents-paperclip.md",
      "company/docs/company-os/17-agent-duties-matrix.md",
    ],
    proposedOwner: "CEO",
    recommendation:
      "CEO owns whether the four-agent structure is producing value; COO reports health, CTO reports technical feasibility, Librarian maintains the durable matrix after ratification.",
  },
  {
    surfaces: ["company/reports/analysis", "company/reports/process", "company/reports/health"],
    proposedOwner: "COO",
    recommendation:
      "COO owns recurring process-health trend detection; CTO owns root-cause technical analysis and ticket design.",
  },
];

export function deriveAgentSystem(bundle: SignalBundle, nowMs: number): AgentSystemV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const agentSignals = uniqueAgentSignals(signals.filter(isAgentSignal));
  const routineSignals = uniqueRoutineSignals(signals.filter(isRoutineSignal));
  const routineHealth = deriveRoutineHealth(bundleWithUniqueRoutineSignals(bundle, routineSignals), nowMs);
  const diagnostics: AgentDiagnosticV1[] = [];

  const agentsByName = new Map<OwnerAgent, AgentSignal>(agentSignals.map((a) => [a.displayName, a]));
  for (const routine of routineSignals) {
    if (!isOwnerAgent(routine.ownerAgent) || !agentsByName.has(routine.ownerAgent)) {
      diagnostics.push({
        code: "unknown_owner_agent",
        severity: "warn",
        message: `Routine ${routine.routineKey} declares unknown ownerAgent ${routine.ownerAgent}.`,
        agentKey: null,
      });
    }
  }

  for (const agent of agentSignals) {
    for (const error of agent.errors) {
      if (error.degraded) {
        diagnostics.push({
          code: "missing_sidecar",
          severity: "warn",
          message: error.message,
          agentKey: agent.agentKey,
        });
      }
    }
    if (/claude/i.test(agent.model)) {
      diagnostics.push({
        code: "model_drift",
        severity: "info",
        message: `${agent.displayName} config model is ${agent.model}; verify against live Paperclip runtime before treating it as burn data.`,
        agentKey: agent.agentKey,
      });
    }
  }

  const sloEntries = routineHealth.routines.map(toRoutineSloEntry).filter((entry): entry is RoutineSloEntryV1 => entry !== null);
  const routinesByOwner = new Map<OwnerAgent, RoutineSloEntryV1[]>();
  for (const entry of sloEntries) {
    const bucket = routinesByOwner.get(entry.ownerAgent) ?? [];
    bucket.push(entry);
    routinesByOwner.set(entry.ownerAgent, bucket);
  }

  const handoffs = deriveHandoffs(agentSignals, diagnostics);
  const overlaps = deriveOverlaps(agentSignals);
  const agents = agentSignals.map((agent) => agentCard(agent, routinesByOwner.get(agent.displayName) ?? []));
  const vitals = deriveVitals(agents, diagnostics);

  return {
    schemaVersion: AGENT_SYSTEM_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    vitals,
    agents,
    overlaps,
    handoffs,
    sources: aggregateSourceFreshness(bundle),
    diagnostics,
  };
}

function agentCard(agent: AgentSignal, ownedRoutines: readonly RoutineSloEntryV1[]): AgentCardV1 {
  return {
    displayName: agent.displayName,
    agentKey: agent.agentKey,
    role: agent.role,
    model: agent.model,
    reportsTo: agent.reportsTo,
    budgetMonthlyCents: agent.budgetMonthlyCents,
    canCreateAgents: agent.canCreateAgents,
    maxTurnsPerRun: agent.maxTurnsPerRun,
    heartbeatIntervalSec: agent.heartbeatIntervalSec,
    summary: agent.summary,
    duties: dutiesFor(agent, ownedRoutines),
    ownedRoutines: [...ownedRoutines].sort((a, b) => a.routineKey.localeCompare(b.routineKey)),
    healthRollup: healthRollup(ownedRoutines),
    handsOffTo: [...agent.handsOffTo],
    receivesFrom: [...agent.receivesFrom],
  };
}

function dutiesFor(agent: AgentSignal, ownedRoutines: readonly RoutineSloEntryV1[]): AgentDutyV1[] {
  // Key by id so a declared duty and an embedded-routine of the SAME id collapse
  // to one entry — the embedded-routine form wins (it carries the routine's SLO
  // semantics). De-duping at the SOURCE keeps the persisted `AgentCardV1.duties`
  // contract array duplicate-free for every consumer, not just one view.
  const byId = new Map<string, AgentDutyV1>();
  for (const d of agent.duties) {
    byId.set(d.id, { id: d.id, label: humanize(d.id), surface: d.surface, kind: "duty" });
  }
  for (const routine of ownedRoutines) {
    if (routine.freshnessKind !== "embedded") continue;
    byId.set(routine.routineKey, {
      id: routine.routineKey,
      label: routine.displayName,
      surface: routine.expectedArtifactGlob === "" ? null : routine.expectedArtifactGlob,
      kind: "embedded-routine",
    });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function toRoutineSloEntry(entry: ReturnType<typeof deriveRoutineHealth>["routines"][number]): RoutineSloEntryV1 | null {
  if (!isOwnerAgent(entry.ownerAgent)) return null;
  return {
    routineKey: entry.routineKey,
    displayName: entry.displayName,
    ownerAgent: entry.ownerAgent,
    cadence: entry.cadence,
    expectedArtifactGlob: entry.expectedArtifactGlob,
    freshnessKind: entry.freshnessKind,
    lastRunAt: entry.lastRunAt,
    nextExpectedAt: entry.nextExpectedAt,
    expectedArtifactPresent: entry.expectedArtifactPresent,
    latestArtifactPath: entry.latestArtifactPath,
    latestArtifactMtime: entry.latestArtifactMtime,
    verdict: entry.verdict,
    detail: entry.detail,
  };
}

function healthRollup(routines: readonly RoutineSloEntryV1[]): RoutineVerdict | null {
  const verdicts = routines
    .filter((r) => r.freshnessKind !== "embedded" && r.verdict !== null)
    .map((r) => r.verdict as RoutineVerdict);
  if (verdicts.length === 0) return null;
  return verdicts.sort((a, b) => VERDICT_SEVERITY[a] - VERDICT_SEVERITY[b])[0] ?? null;
}

function deriveVitals(agents: readonly AgentCardV1[], diagnostics: readonly AgentDiagnosticV1[]) {
  const counts: VerdictCountsV1 = { fresh: 0, stale: 0, missing: 0, never_ran: 0 };
  let sloTotal = 0;
  for (const agent of agents) {
    for (const routine of agent.ownedRoutines) {
      if (routine.freshnessKind === "embedded" || routine.verdict === null) continue;
      counts[routine.verdict] += 1;
      sloTotal += 1;
    }
  }
  const fresh = counts.fresh;
  const heartbeatIntervals = new Set(agents.map((a) => a.heartbeatIntervalSec).filter((v): v is number => v !== null));
  return {
    agentCount: agents.length,
    routinesFreshPct: sloTotal === 0 ? 0 : Math.round((fresh / sloTotal) * 100),
    verdictCounts: counts,
    budgetMonthlyCentsTotal: agents.reduce((sum, a) => sum + (a.budgetMonthlyCents ?? 0), 0),
    heartbeatCadence: heartbeatCadence(heartbeatIntervals),
    diagnosticsCount: diagnostics.length,
  };
}

function heartbeatCadence(intervals: ReadonlySet<number>): string | null {
  if (intervals.size === 0) return null;
  if (intervals.size > 1) return "mixed";
  const value = [...intervals][0];
  if (value === 86_400) return "daily";
  if (value === 3_600) return "hourly";
  return `${value}s`;
}

function deriveHandoffs(agentSignals: readonly AgentSignal[], diagnostics: AgentDiagnosticV1[]): HandoffEdgeV1[] {
  const byName = new Map(agentSignals.map((a) => [a.displayName, a]));
  const edges = new Map<string, HandoffEdgeV1>();
  for (const agent of agentSignals) {
    for (const target of agent.handsOffTo) {
      const targetAgent = isOwnerAgent(target) ? byName.get(target) : undefined;
      const consistent = targetAgent?.receivesFrom.includes(agent.displayName) === true;
      const key = `${agent.displayName}->${target}`;
      edges.set(key, { from: agent.displayName, to: target, consistent });
      if (!consistent) {
        diagnostics.push({
          code: "handoff_mismatch",
          severity: "warn",
          message: `${agent.displayName} hands off to ${target}, but ${target} does not list ${agent.displayName} in receivesFrom.`,
          agentKey: agent.agentKey,
        });
      }
    }
  }
  return [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

function deriveOverlaps(agentSignals: readonly AgentSignal[]): OverlapEdgeV1[] {
  const claims: Array<{ agent: OwnerAgent; surface: string }> = [];
  for (const agent of agentSignals) {
    for (const duty of agent.duties) {
      if (!duty.surface) continue;
      claims.push({ agent: agent.displayName, surface: normalizeSurface(duty.surface) });
    }
  }

  const bySurface = new Map<string, Set<OwnerAgent>>();
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];
      if (a.agent === b.agent) continue;
      const surface = overlappingSurface(a.surface, b.surface);
      if (!surface) continue;
      const agents = bySurface.get(surface) ?? new Set<OwnerAgent>();
      agents.add(a.agent);
      agents.add(b.agent);
      bySurface.set(surface, agents);
    }
  }

  return [...bySurface.entries()]
    .map(([surface, agents]): OverlapEdgeV1 => {
      const resolution = resolutionForSurface(surface);
      return {
        surface,
        agents: [...agents].sort(ownerRank),
        proposedOwner: resolution?.proposedOwner ?? null,
        recommendation: resolution?.recommendation ?? null,
      };
    })
    .filter((edge) => edge.agents.length >= 2)
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function resolutionForSurface(surface: string): OverlapResolution | null {
  const normalized = normalizeSurface(surface);
  return OVERLAP_RESOLUTIONS.find((resolution) =>
    resolution.surfaces.some((candidate) => overlappingSurface(normalized, normalizeSurface(candidate)) !== null),
  ) ?? null;
}

function normalizeSurface(surface: string): string {
  const noGlob = surface.replace(/\/?\*.*$/, "");
  return noGlob.replace(/\/+$/, "");
}

function overlappingSurface(a: string, b: string): string | null {
  if (a === b) return a;
  if (b.startsWith(`${a}/`)) return a;
  if (a.startsWith(`${b}/`)) return b;
  return null;
}

function agentOrder(a: AgentSignal, b: AgentSignal): number {
  return ownerRank(a.displayName, b.displayName) || a.agentKey.localeCompare(b.agentKey);
}

function uniqueAgentSignals(agentSignals: readonly AgentSignal[]): AgentSignal[] {
  const byOwner = new Map<OwnerAgent, AgentSignal>();
  for (const agent of [...agentSignals].sort(agentOrder)) {
    const incumbent = byOwner.get(agent.displayName);
    if (!incumbent || isBetterSignalSource(agent, incumbent)) {
      byOwner.set(agent.displayName, agent);
    }
  }
  return [...byOwner.values()].sort(agentOrder);
}

function uniqueRoutineSignals(routineSignals: readonly RoutineSignal[]): RoutineSignal[] {
  const byOwnerRoutine = new Map<string, RoutineSignal>();
  for (const routine of [...routineSignals].sort(routineOrder)) {
    const key = `${routine.ownerAgent}\0${routine.routineKey}`;
    const incumbent = byOwnerRoutine.get(key);
    if (!incumbent || isBetterSignalSource(routine, incumbent)) {
      byOwnerRoutine.set(key, routine);
    }
  }
  return [...byOwnerRoutine.values()].sort(routineOrder);
}

function bundleWithUniqueRoutineSignals(bundle: SignalBundle, routineSignals: readonly RoutineSignal[]): SignalBundle {
  let inserted = false;
  return {
    ...bundle,
    batches: bundle.batches.map((batch) => {
      const nonRoutineSignals = batch.signals.filter((signal) => !isRoutineSignal(signal));
      if (inserted) return { ...batch, signals: nonRoutineSignals };
      inserted = true;
      return { ...batch, signals: [...nonRoutineSignals, ...routineSignals] };
    }),
  };
}

function routineOrder(a: RoutineSignal, b: RoutineSignal): number {
  return ownerSortValue(a.ownerAgent) - ownerSortValue(b.ownerAgent)
    || a.ownerAgent.localeCompare(b.ownerAgent)
    || a.routineKey.localeCompare(b.routineKey)
    || a.repo.localeCompare(b.repo);
}

interface SourceQualityInput {
  readonly repo: string;
  readonly freshness: AgentSignal["freshness"];
  readonly errors: AgentSignal["errors"];
}

function isBetterSignalSource(candidate: SourceQualityInput, incumbent: SourceQualityInput): boolean {
  const qualityDelta = signalSourceQuality(candidate) - signalSourceQuality(incumbent);
  if (qualityDelta !== 0) return qualityDelta < 0;
  return candidate.repo.localeCompare(incumbent.repo) < 0;
}

function signalSourceQuality(input: SourceQualityInput): number {
  const freshnessRank = input.freshness === "live" ? 0 : input.freshness === "cached" ? 1 : 2;
  const degradedErrors = input.errors.filter((error) => error.degraded).length;
  return freshnessRank * 100 + degradedErrors * 10 + input.errors.length;
}

function ownerSortValue(ownerAgent: string): number {
  const rank = OWNER_AGENTS.indexOf(ownerAgent as OwnerAgent);
  return rank === -1 ? OWNER_AGENTS.length : rank;
}

function ownerRank(a: OwnerAgent, b?: OwnerAgent): number {
  const rankA = OWNER_AGENTS.indexOf(a);
  if (b === undefined) return rankA;
  return rankA - OWNER_AGENTS.indexOf(b);
}

function isOwnerAgent(value: string): value is OwnerAgent {
  return OWNER_AGENTS.includes(value as OwnerAgent);
}

function humanize(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || id;
}
