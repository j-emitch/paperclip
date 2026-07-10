/**
 * `GatesStateV1` — the persisted COS-11 Gates & Pipeline projection (spec §4):
 * per-repo hook parity + gate receipts, per-target migration-audit posture,
 * the two provenance ledgers, and branch-protection-as-code desired state.
 * zod-first (mirrors doc-index/worktree-board): validated before write and on
 * read, so a malformed cache row re-derives instead of rendering.
 *
 * Row-8 last-good: a migration target the CURRENT derive produced no live row
 * for keeps the prior derive's row with `lastGood: true` — the merge lives in
 * `deriveGatesState`, never in the source.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema } from "./diagnostics.js";

export const GATES_STATE_SCHEMA_VERSION = 1 as const;

/** The newest cannons-runs receipt joined to one repo (pre-push gate outcome). */
export const gateRunV1Schema = z.object({
  runId: z.string().min(1),
  sha8: z.string().min(1),
  verdict: z.string().min(1),
  at: z.string().min(1),
});
export type GateRunV1 = z.infer<typeof gateRunV1Schema>;

/** One repo's hook-install/parity row (from `HooksSignal`). */
export const repoHooksV1Schema = z.object({
  repoKey: z.string().min(1),
  hooksPathValue: z.string().nullable(),
  parity: z.enum(["in_sync", "drifted", "missing", "unknown"]),
  driftedHooks: z.array(z.string()),
  lastGuardrailAt: z.string().nullable(),
  guardrailHookKinds: z.array(z.string()),
  lastGateRun: gateRunV1Schema.nullable(),
});
export type RepoHooksV1 = z.infer<typeof repoHooksV1Schema>;

/** One migration-audit target row (from `MigrationAuditSignal`, or carried last-good). */
export const migrationTargetV1Schema = z.object({
  target: z.string().min(1),
  ranAt: z.string().nullable(),
  auditRelPath: z.string().min(1),
  auditMtime: z.string().nullable(),
  totalEntries: z.number().int(),
  notAppliedCount: z.number().int(),
  orphanTrackerRows: z.number().int(),
  unauditedBranchFiles: z.number().int(),
  grantSurfaceViolations: z.number().int(),
  grantSurfaceScanned: z.number().int(),
  lastApplyRelPath: z.string().nullable(),
  lastApplyAt: z.string().nullable(),
  /** true = carried from a PRIOR derive (row-8) — renders as a stale marker, never silent-green. */
  lastGood: z.boolean(),
});
export type MigrationTargetV1 = z.infer<typeof migrationTargetV1Schema>;

export const cannonsRunV1Schema = z.object({
  runId: z.string().min(1),
  sha8: z.string().min(1),
  verdict: z.string().min(1),
  repo: z.string().min(1),
  at: z.string().min(1),
  reportPath: z.string().nullable(),
});
export type CannonsRunV1 = z.infer<typeof cannonsRunV1Schema>;

export const codexRowV1Schema = z.object({
  t: z.string().min(1),
  consumer: z.string().min(1),
  repo: z.string(),
  success: z.boolean(),
  model: z.string(),
});
export type CodexRowV1 = z.infer<typeof codexRowV1Schema>;

/** One provenance ledger's parsed tail (from `DispatchLedgerSignal`). */
export const ledgerV1Schema = z.object({
  ledger: z.enum(["cannons_runs", "codex_invocations"]),
  /** true = the tail window clipped history — renders "history truncated at logMtime". */
  truncated: z.boolean(),
  logMtime: z.string().nullable(),
  cannonsRuns: z.array(cannonsRunV1Schema).default([]),
  codexRows: z.array(codexRowV1Schema).default([]),
});
export type LedgerV1 = z.infer<typeof ledgerV1Schema>;

/** One managed repo's branch-protection desired state (from `ProtectionSignal`). */
export const protectionRepoV1Schema = z.object({
  repoName: z.string().min(1),
  slug: z.string().min(1),
  branch: z.string().min(1),
  enforceAdmins: z.boolean().nullable(),
  requiredChecks: z.array(z.string()),
  requiredReviews: z.number().int().nullable(),
  /** null = NEVER verified against live (no assert receipt exists) — an honest warn tier. */
  verifiedAt: z.string().nullable(),
});
export type ProtectionRepoV1 = z.infer<typeof protectionRepoV1Schema>;

export const gatesStateV1Schema = z.object({
  schemaVersion: z.literal(GATES_STATE_SCHEMA_VERSION),
  derivedAt: z.string().min(1),
  /** Sorted by repoKey. */
  hooks: z.array(repoHooksV1Schema),
  /** The canonical GATE_SUITES roster ([] when unreadable). */
  gateSuites: z.array(z.string()),
  /** Sorted by target. */
  migrations: z.array(migrationTargetV1Schema),
  /** Sorted by ledger name. */
  ledgers: z.array(ledgerV1Schema),
  /** Sorted by repoName. */
  protection: z.array(protectionRepoV1Schema),
  diagnostics: z.array(diagnosticSchema),
});
export type GatesStateV1 = z.infer<typeof gatesStateV1Schema>;

export function parseGatesStateV1(input: unknown): GatesStateV1 {
  return gatesStateV1Schema.parse(input);
}

export function safeParseGatesStateV1(input: unknown): z.SafeParseReturnType<unknown, GatesStateV1> {
  return gatesStateV1Schema.safeParse(input);
}
