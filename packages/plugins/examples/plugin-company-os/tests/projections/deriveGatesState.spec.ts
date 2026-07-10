import { describe, expect, it } from "vitest";
import { deriveGatesState } from "../../src/projections/deriveGatesState.js";
import { GATES_SOURCE_IDS } from "../../src/contracts/gates.js";
import { HOOKS_SOURCE_ID, hooksSource } from "../../src/sources/HooksSource.js";
import { MIGRATION_AUDIT_SOURCE_ID } from "../../src/sources/MigrationAuditSource.js";
import { DISPATCH_LEDGER_SOURCE_ID } from "../../src/sources/DispatchLedgerSource.js";
import { PROTECTION_SOURCE_ID } from "../../src/sources/ProtectionSource.js";
import type { SignalBatch, SignalBundle } from "../../src/contracts/WorkSignalSource.js";
import type {
  DispatchLedgerSignal,
  HooksSignal,
  MigrationAuditSignal,
  ProtectionSignal,
} from "../../src/contracts/signals.js";
import type { GatesStateV1 } from "../../src/contracts/gates-state.js";
import { parseGatesStateV1 } from "../../src/contracts/gates-state.js";
import { GATES_BUDGET_MS } from "../../src/contracts/gates.js";
import { isHooksSignal } from "../../src/contracts/signals.js";
import type { Clock } from "../../src/contracts/collection-context.js";
import { FIXED_NOW, makeFixtureContext } from "../fixtures/context.js";

const NOW = FIXED_NOW;

function batch(source: string, signals: SignalBatch["signals"], repoFreshness: SignalBatch["repoFreshness"] = []): SignalBatch {
  return { source, collectedAt: NOW, signals, repoFreshness };
}

function bundleOf(...batches: SignalBatch[]): SignalBundle {
  return { collectedAt: NOW, batches };
}

const HOOKS_SIG: HooksSignal = {
  kind: "hooks",
  source: HOOKS_SOURCE_ID,
  repo: "juice-bar",
  confidence: "high",
  freshness: "live",
  errors: [],
  hooksPathValue: "~/.claude/hooks",
  parity: "in_sync",
  driftedHooks: [],
  gateSuites: ["test-coh-footguns.sh"],
  lastGuardrailAt: "2026-07-09T00:00:00Z",
  guardrailHookKinds: ["typecheck"],
  lastGateRun: { runId: "1-1-1", sha8: "aaaaaaaa", verdict: "ship", at: "2026-07-08T00:00:00Z" },
};

const MIG_SIG: MigrationAuditSignal = {
  kind: "migration_audit",
  source: MIGRATION_AUDIT_SOURCE_ID,
  repo: "juice-bar",
  confidence: "high",
  freshness: "live",
  errors: [],
  target: "staging",
  ranAt: "2026-07-01T00:00:00Z",
  auditRelPath: "reports/migrations/audit-staging.json",
  auditMtime: "2026-07-01T00:00:00.000Z",
  totalEntries: 2,
  notAppliedCount: 0,
  orphanTrackerRows: 0,
  unauditedBranchFiles: 0,
  grantSurfaceViolations: 0,
  grantSurfaceScanned: 42,
  lastApplyRelPath: "reports/migration-apply/a.md",
  lastApplyAt: "2026-07-01T00:00:00.000Z",
};

const LEDGER_SIG: DispatchLedgerSignal = {
  kind: "dispatch_ledger",
  source: DISPATCH_LEDGER_SOURCE_ID,
  repo: "company",
  confidence: "high",
  freshness: "live",
  errors: [],
  ledger: "cannons_runs",
  truncated: false,
  logMtime: "2026-07-09T00:00:00.000Z",
  cannonsRuns: [{ runId: "1-1-1", sha8: "aaaaaaaa", verdict: "ship", repo: "juice-bar", at: "2026-07-08T00:00:00Z", reportPath: null }],
};

const PROT_SIG: ProtectionSignal = {
  kind: "protection",
  source: PROTECTION_SOURCE_ID,
  repo: "company",
  confidence: "high",
  freshness: "live",
  errors: [],
  repoName: "juice-bar",
  slug: "j-emitch/JuiceBar",
  branch: "main",
  enforceAdmins: false,
  requiredChecks: ["API (lint + test + build + tsc)"],
  requiredReviews: 1,
  verifiedAt: null,
};

describe("deriveGatesState", () => {
  it("folds all four kinds into a schema-valid GatesStateV1", () => {
    const state = deriveGatesState(
      bundleOf(
        batch(HOOKS_SOURCE_ID, [HOOKS_SIG]),
        batch(MIGRATION_AUDIT_SOURCE_ID, [MIG_SIG]),
        batch(DISPATCH_LEDGER_SOURCE_ID, [LEDGER_SIG]),
        batch(PROTECTION_SOURCE_ID, [PROT_SIG]),
      ),
      NOW,
      null,
    );
    // Round-trips the persisted schema (validate-before-write would accept it).
    expect(() => parseGatesStateV1(state)).not.toThrow();
    expect(state.hooks).toHaveLength(1);
    expect(state.hooks[0].parity).toBe("in_sync");
    expect(state.gateSuites).toEqual(["test-coh-footguns.sh"]);
    expect(state.migrations).toEqual([expect.objectContaining({ target: "staging", lastGood: false })]);
    expect(state.ledgers[0].cannonsRuns).toHaveLength(1);
    expect(state.ledgers[0].codexRows).toEqual([]);
    expect(state.protection[0].verifiedAt).toBeNull();
    expect(state.diagnostics).toEqual([]);
  });

  it("row-8 last-good: a prior migration target with no live row is carried with lastGood + an info diagnostic", () => {
    const prior: GatesStateV1 = deriveGatesState(bundleOf(batch(MIGRATION_AUDIT_SOURCE_ID, [MIG_SIG])), NOW, null);
    const next = deriveGatesState(
      bundleOf(
        batch(MIGRATION_AUDIT_SOURCE_ID, [{ ...MIG_SIG, target: "prod", auditRelPath: "reports/migrations/audit-prod.json" }]),
      ),
      NOW,
      prior,
    );
    expect(next.migrations.map((m) => `${m.target}:${m.lastGood}`)).toEqual(["prod:false", "staging:true"]);
    expect(next.diagnostics).toEqual([
      expect.objectContaining({ level: "info", code: "migration_audit_last_good", source: "migration_audit" }),
    ]);
    // The carry is NOT transitive-silent: a third derive still marks it lastGood.
    const third = deriveGatesState(bundleOf(), NOW, next);
    expect(third.migrations.every((m) => m.lastGood)).toBe(true);
  });

  it("degraded freshness on a gates batch surfaces as a warn diagnostic; non-gates batches are ignored", () => {
    const state = deriveGatesState(
      bundleOf(
        batch(MIGRATION_AUDIT_SOURCE_ID, [], [
          {
            repo: "juice-bar",
            freshness: "stale",
            lastOkAt: null,
            errors: [{ code: "parse_error", message: "unparseable audit", degraded: true }],
          },
        ]),
        batch("git-work", [], [
          {
            repo: "juice-bar",
            freshness: "stale",
            lastOkAt: null,
            errors: [{ code: "subprocess_failed", message: "not a gates concern", degraded: true }],
          },
        ]),
      ),
      NOW,
      null,
    );
    expect(state.diagnostics).toEqual([
      expect.objectContaining({ level: "warn", code: "parse_error", source: "migration_audit", repo: "juice-bar" }),
    ]);
  });

  it("GATES_SOURCE_IDS stays in lockstep with the four sources' exported ids (drift guard)", () => {
    expect([...GATES_SOURCE_IDS].sort()).toEqual(
      [HOOKS_SOURCE_ID, MIGRATION_AUDIT_SOURCE_ID, DISPATCH_LEDGER_SOURCE_ID, PROTECTION_SOURCE_ID].sort(),
    );
  });
});

describe("HooksSource GATES_BUDGET_MS backstop", () => {
  it("repos past the budget are skipped with a degraded error, never a silent green row", async () => {
    // A clock that burns > GATES_BUDGET_MS per call: repo 1 reads fine, repo 2 is over budget.
    let t = FIXED_NOW;
    const burningClock: Clock = { now: () => (t += GATES_BUDGET_MS) };
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "arc-scraper", available: true },
        { repo: "company", available: true },
      ],
      files: { company: { ".githooks/pre-push": { content: "#!/bin/sh\n" } } },
      clock: burningClock,
    });
    const batchResult = await hooksSource.collect(ctx);
    const emitted = new Set(batchResult.signals.filter(isHooksSignal).map((s) => s.repo));
    const staleRepos = batchResult.repoFreshness.filter((f) => f.freshness === "stale").map((f) => f.repo);
    // At least one repo was budget-skipped and shows STALE + zero signal (honest absence).
    expect(staleRepos.length).toBeGreaterThan(0);
    for (const repo of staleRepos) expect(emitted.has(repo)).toBe(false);
    expect(
      batchResult.repoFreshness
        .flatMap((f) => f.errors)
        .some((e) => e.code === "subprocess_timeout" && /gates budget exhausted/.test(e.message)),
    ).toBe(true);
  });
});
