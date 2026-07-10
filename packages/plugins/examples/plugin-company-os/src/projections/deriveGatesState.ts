/**
 * `deriveGatesState` — fold the four COS-11 gates signal kinds into the
 * persisted `GatesStateV1`. Pure (bundle + nowMs + PRIOR state in, projection
 * out) like every other derive.
 *
 * Row-8 last-good merge (lives HERE, not in a source): a migration target the
 * current derive produced no live row for — degraded audit parse, unreadable
 * reports dir, pruned files — keeps the prior derive's row with
 * `lastGood: true` and an info diagnostic, so the Gates band renders a visibly
 * stale posture instead of a vanished target or a silent green.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import {
  GATES_STATE_SCHEMA_VERSION,
  type GatesStateV1,
  type LedgerV1,
  type MigrationTargetV1,
  type ProtectionRepoV1,
  type RepoHooksV1,
} from "../contracts/gates-state.js";
import { GATES_SOURCE_IDS } from "../contracts/gates.js";
import {
  isDispatchLedgerSignal,
  isHooksSignal,
  isMigrationAuditSignal,
  isProtectionSignal,
} from "../contracts/signals.js";

export function deriveGatesState(bundle: SignalBundle, nowMs: number, prior: GatesStateV1 | null): GatesStateV1 {
  const gatesSourceIds = new Set<string>(GATES_SOURCE_IDS);
  const signals = bundle.batches.flatMap((b) => b.signals);
  const diagnostics: Diagnostic[] = [];

  // Degraded freshness on any gates batch surfaces as a warn diagnostic (the
  // same idiom every projection uses) — "why is this row stale" is renderable.
  for (const batch of bundle.batches) {
    if (!gatesSourceIds.has(batch.source)) continue;
    for (const rf of batch.repoFreshness) {
      for (const e of rf.errors) {
        if (!e.degraded) continue;
        diagnostics.push({ level: "warn", code: e.code, message: e.message, repo: rf.repo, source: batch.source });
      }
    }
  }

  const hooks: RepoHooksV1[] = signals
    .filter(isHooksSignal)
    .map((s) => ({
      repoKey: s.repo,
      hooksPathValue: s.hooksPathValue,
      parity: s.parity,
      driftedHooks: [...s.driftedHooks],
      lastGuardrailAt: s.lastGuardrailAt,
      guardrailHookKinds: [...s.guardrailHookKinds],
      lastGateRun: s.lastGateRun ? { ...s.lastGateRun } : null,
    }))
    .sort((a, b) => a.repoKey.localeCompare(b.repoKey));

  // The canonical roster is company-global — every HooksSignal carries the same
  // parse; take the first non-empty so one repo's degraded read can't blank it.
  const gateSuites = signals.filter(isHooksSignal).find((s) => s.gateSuites.length > 0)?.gateSuites ?? [];

  // Live migration rows first...
  const migrationsByTarget = new Map<string, MigrationTargetV1>();
  for (const s of signals.filter(isMigrationAuditSignal)) {
    migrationsByTarget.set(s.target, {
      target: s.target,
      ranAt: s.ranAt,
      auditRelPath: s.auditRelPath,
      auditMtime: s.auditMtime,
      totalEntries: s.totalEntries,
      notAppliedCount: s.notAppliedCount,
      orphanTrackerRows: s.orphanTrackerRows,
      unauditedBranchFiles: s.unauditedBranchFiles,
      grantSurfaceViolations: s.grantSurfaceViolations,
      grantSurfaceScanned: s.grantSurfaceScanned,
      lastApplyRelPath: s.lastApplyRelPath,
      lastApplyAt: s.lastApplyAt,
      openDriftIssueCount: s.openDriftIssueCount,
      rollingIssueNumber: s.rollingIssueNumber,
      // A non-live signal is CARRIED data (scoped-merge rehydration, or the
      // source staled it — e.g. an older file emitted past a corrupt newest):
      // it must wear the last-good marker just like a fold-carried row.
      lastGood: s.freshness !== "live",
    });
  }
  // ...then the row-8 carry: any prior target with no live row this derive.
  for (const prev of prior?.migrations ?? []) {
    if (migrationsByTarget.has(prev.target)) continue;
    migrationsByTarget.set(prev.target, { ...prev, lastGood: true });
    diagnostics.push({
      level: "info",
      code: "migration_audit_last_good",
      message: `no live audit row for target "${prev.target}" this derive — carrying the prior derive's value`,
      repo: null,
      source: "migration_audit",
    });
  }
  const migrations = [...migrationsByTarget.values()].sort((a, b) => a.target.localeCompare(b.target));

  const ledgers: LedgerV1[] = signals
    .filter(isDispatchLedgerSignal)
    .map((s) => ({
      ledger: s.ledger,
      truncated: s.truncated,
      logMtime: s.logMtime,
      cannonsRuns: (s.cannonsRuns ?? []).map((r) => ({ ...r })),
      codexRows: (s.codexRows ?? []).map((r) => ({ ...r })),
    }))
    .sort((a, b) => a.ledger.localeCompare(b.ledger));

  const protection: ProtectionRepoV1[] = signals
    .filter(isProtectionSignal)
    .map((s) => ({
      repoName: s.repoName,
      slug: s.slug,
      branch: s.branch,
      enforceAdmins: s.enforceAdmins,
      requiredChecks: [...s.requiredChecks],
      requiredReviews: s.requiredReviews,
      verifiedAt: s.verifiedAt,
    }))
    .sort((a, b) => a.repoName.localeCompare(b.repoName));

  return {
    schemaVersion: GATES_STATE_SCHEMA_VERSION,
    derivedAt: new Date(nowMs).toISOString(),
    hooks,
    gateSuites: [...gateSuites],
    migrations,
    ledgers,
    protection,
    diagnostics,
  };
}
