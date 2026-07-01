/**
 * `AgentSystemV1` — the persisted contract for the COS-1R Agents cockpit.
 *
 * It is intentionally a view contract, not a source format: sources emit plain
 * `AgentSignal`s, projections join those with routine health, and this zod
 * schema validates the cache/worker/UI payload boundary.
 */

import { z } from "@paperclipai/plugin-sdk";
import { sourceFreshnessSchema } from "./diagnostics.js";
import {
  FRESHNESS_KINDS,
  OWNER_AGENTS,
  ROUTINE_VERDICTS,
  type AssertEqual,
  type Expect,
  type FreshnessKind,
  type OwnerAgent,
  type RoutineVerdict,
} from "./vocab.js";

export const AGENT_SYSTEM_SCHEMA_VERSION = 1 as const;

export const agentDiagnosticCodes = [
  "unknown_owner_agent",
  "handoff_mismatch",
  "missing_sidecar",
  "model_drift",
] as const;
export type AgentDiagnosticCode = (typeof agentDiagnosticCodes)[number];

export const agentDiagnosticSeverities = ["info", "warn"] as const;
export type AgentDiagnosticSeverity = (typeof agentDiagnosticSeverities)[number];

export const ownerAgentSchema = z.enum(OWNER_AGENTS);
export const agentRoutineVerdictSchema = z.enum(ROUTINE_VERDICTS);
export const freshnessKindSchema = z.enum(FRESHNESS_KINDS);
export const agentNullableRoutineVerdictSchema = z.union([agentRoutineVerdictSchema, z.null()]);

export const verdictCountsSchema = z.object({
  fresh: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  never_ran: z.number().int().nonnegative(),
});
export type VerdictCountsV1 = z.infer<typeof verdictCountsSchema>;

export const agentSystemVitalsV1Schema = z.object({
  agentCount: z.number().int().nonnegative(),
  routinesFreshPct: z.number().int().min(0).max(100),
  verdictCounts: verdictCountsSchema,
  budgetMonthlyCentsTotal: z.number().int().nonnegative(),
  heartbeatCadence: z.string().nullable(),
  diagnosticsCount: z.number().int().nonnegative(),
});
export type AgentSystemVitalsV1 = z.infer<typeof agentSystemVitalsV1Schema>;

export const agentDutyV1Schema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  surface: z.string().nullable(),
  kind: z.enum(["duty", "embedded-routine"]),
});
export type AgentDutyV1 = z.infer<typeof agentDutyV1Schema>;

export const routineSloEntryV1Schema = z.object({
  routineKey: z.string().min(1),
  displayName: z.string().min(1),
  ownerAgent: ownerAgentSchema,
  cadence: z.string().min(1),
  expectedArtifactGlob: z.string(),
  freshnessKind: freshnessKindSchema,
  lastRunAt: z.string().nullable(),
  nextExpectedAt: z.string().nullable(),
  expectedArtifactPresent: z.boolean(),
  latestArtifactPath: z.string().nullable(),
  latestArtifactMtime: z.string().nullable(),
  verdict: agentNullableRoutineVerdictSchema,
  detail: z.string().nullable(),
});
export type RoutineSloEntryV1 = z.infer<typeof routineSloEntryV1Schema>;

export const agentCardV1Schema = z.object({
  displayName: ownerAgentSchema,
  agentKey: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
  reportsTo: z.string().nullable(),
  budgetMonthlyCents: z.number().int().nonnegative().nullable(),
  canCreateAgents: z.boolean(),
  maxTurnsPerRun: z.number().int().positive().nullable(),
  heartbeatIntervalSec: z.number().int().positive().nullable(),
  summary: z.string().nullable(),
  duties: z.array(agentDutyV1Schema),
  ownedRoutines: z.array(routineSloEntryV1Schema),
  healthRollup: agentNullableRoutineVerdictSchema,
  handsOffTo: z.array(z.string().min(1)),
  receivesFrom: z.array(z.string().min(1)),
});
export type AgentCardV1 = z.infer<typeof agentCardV1Schema>;

export const overlapEdgeV1Schema = z.object({
  surface: z.string().min(1),
  agents: z.array(ownerAgentSchema).min(2),
  // A proposed owner is an OwnerAgent, not a free string — tighten so cache
  // validation rejects a non-agent owner (codex B). The projection already
  // models it as OwnerAgent.
  proposedOwner: ownerAgentSchema.nullable(),
  recommendation: z.string().nullable(),
});
export type OverlapEdgeV1 = z.infer<typeof overlapEdgeV1Schema>;

export const handoffEdgeV1Schema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  consistent: z.boolean(),
});
export type HandoffEdgeV1 = z.infer<typeof handoffEdgeV1Schema>;

export const agentDiagnosticV1Schema = z.object({
  code: z.enum(agentDiagnosticCodes),
  severity: z.enum(agentDiagnosticSeverities),
  message: z.string(),
  agentKey: z.string().nullable(),
});
export type AgentDiagnosticV1 = z.infer<typeof agentDiagnosticV1Schema>;

export const agentSystemV1Schema = z.object({
  schemaVersion: z.literal(AGENT_SYSTEM_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  vitals: agentSystemVitalsV1Schema,
  agents: z.array(agentCardV1Schema),
  overlaps: z.array(overlapEdgeV1Schema),
  handoffs: z.array(handoffEdgeV1Schema),
  sources: z.array(sourceFreshnessSchema),
  diagnostics: z.array(agentDiagnosticV1Schema),
});
export type AgentSystemV1 = z.infer<typeof agentSystemV1Schema>;

/** Parse + validate (throws on malformed). Use on cache read + before worker return. */
export function parseAgentSystemV1(input: unknown): AgentSystemV1 {
  return agentSystemV1Schema.parse(input);
}

export function safeParseAgentSystemV1(input: unknown): z.SafeParseReturnType<unknown, AgentSystemV1> {
  return agentSystemV1Schema.safeParse(input);
}

// Drift guards: schema enums and canonical tuples cannot diverge.
type _OwnerAgentMatches = Expect<AssertEqual<z.infer<typeof ownerAgentSchema>, OwnerAgent>>;
type _FreshnessKindMatches = Expect<AssertEqual<z.infer<typeof freshnessKindSchema>, FreshnessKind>>;
type _RoutineVerdictMatches = Expect<AssertEqual<z.infer<typeof agentRoutineVerdictSchema>, RoutineVerdict>>;
