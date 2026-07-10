import { describe, expect, it } from "vitest";
import { migrationAuditSource, parseMigrationAudit } from "../../src/sources/MigrationAuditSource.js";
import { isMigrationAuditSignal, type MigrationAuditSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, proc } from "../fixtures/context.js";

/** Ground-truthed audit JSON shape (audit-migrations-drift.ts output). */
function auditJson(target: string, ranAt: string, notApplied = 0): string {
  const entries = [
    { migration: "158_a.sql", applied: "yes", evidence: "table x", in_migrations_table: true },
    { migration: "159_b.sql", applied: notApplied > 0 ? "no" : "yes", evidence: "", in_migrations_table: true },
  ];
  return JSON.stringify({
    target,
    target_host: `${target}.db.example`,
    ran_at: ranAt,
    entries,
    orphan_tracker_rows: [],
    unaudited_branch_files: notApplied > 0 ? ["160_c.sql"] : [],
    grant_surface_violations: [],
    grant_surface_scanned: 42,
    grant_surface_inert: false,
  });
}

describe("MigrationAuditSource", () => {
  it("emits one signal per target — newest audit file per target wins — plus the newest apply receipt", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "reports/migrations/audit-staging-old.json": { content: auditJson("staging", "2026-06-01T00:00:00Z", 3), mtime: "2026-06-01T00:00:00.000Z" },
          "reports/migrations/audit-staging-new.json": { content: auditJson("staging", "2026-07-01T00:00:00Z"), mtime: "2026-07-01T00:00:00.000Z" },
          "reports/migrations/audit-prod.json": { content: auditJson("prod", "2026-07-02T00:00:00Z", 1), mtime: "2026-07-02T00:00:00.000Z" },
          "reports/migration-apply/2026-06-20-0900-prod.md": { content: "# apply", mtime: "2026-06-20T09:00:00.000Z" },
          "reports/migration-apply/2026-07-03-1200-prod.md": { content: "# apply", mtime: "2026-07-03T12:00:00.000Z" },
        },
      },
    });
    const batch = await migrationAuditSource.collect(ctx);
    const sigs = batch.signals.filter(isMigrationAuditSignal) as MigrationAuditSignal[];
    expect(sigs.map((s) => s.target).sort()).toEqual(["prod", "staging"]);
    const staging = sigs.find((s) => s.target === "staging")!;
    // The NEWEST staging file won (clean, not the old drifted one).
    expect(staging.auditRelPath).toBe("reports/migrations/audit-staging-new.json");
    expect(staging.notAppliedCount).toBe(0);
    expect(staging.totalEntries).toBe(2);
    const prod = sigs.find((s) => s.target === "prod")!;
    expect(prod.notAppliedCount).toBe(1);
    expect(prod.unauditedBranchFiles).toBe(1);
    expect(prod.grantSurfaceScanned).toBe(42);
    // Both carry the newest apply receipt by mtime.
    expect(staging.lastApplyRelPath).toBe("reports/migration-apply/2026-07-03-1200-prod.md");
    expect(staging.lastApplyAt).toBe("2026-07-03T12:00:00.000Z");
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("an unparseable newest audit records parse_error + stales freshness; the older parseable file still surfaces (visibly older auditMtime)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "reports/migrations/audit-staging-ok.json": { content: auditJson("staging", "2026-06-01T00:00:00Z"), mtime: "2026-06-01T00:00:00.000Z" },
          "reports/migrations/audit-staging-corrupt.json": { content: "{not json", mtime: "2026-07-01T00:00:00.000Z" },
        },
      },
    });
    const batch = await migrationAuditSource.collect(ctx);
    const sigs = batch.signals.filter(isMigrationAuditSignal) as MigrationAuditSignal[];
    expect(sigs).toHaveLength(1);
    expect(sigs[0].auditRelPath).toBe("reports/migrations/audit-staging-ok.json");
    expect(sigs[0].auditMtime).toBe("2026-06-01T00:00:00.000Z");
    const fresh = batch.repoFreshness[0]!;
    expect(fresh.freshness).toBe("stale");
    expect(fresh.errors.some((e) => e.code === "parse_error")).toBe(true);
  });

  it("no audits + no receipts: no signals, live freshness (a repo that never ran the audit is NORMAL)", async () => {
    const ctx = makeFixtureContext({ repos: [{ repo: "juice-bar", available: true }], files: { "juice-bar": {} } });
    const batch = await migrationAuditSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("emits nothing on a scoped refresh that doesn't touch juice-bar", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "juice-bar", available: true },
        { repo: "company", available: true },
      ],
      scopeRepo: "company",
    });
    const batch = await migrationAuditSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness).toHaveLength(0);
  });

  it("drift-issue lane: counts open [INFRA-DB-CD] titles + finds each target's rolling issue by body marker", async () => {
    const issues = JSON.stringify([
      { number: 400, title: "unrelated", body: "" },
      { number: 410, title: "[INFRA-DB-CD] Drift detected on staging (2026-07-10, 2 entries)", body: "<!-- infra-db-cd-rolling:staging -->\nrolling" },
      { number: 411, title: "[INFRA-DB-CD] Drift detected on prod (2026-07-09, 1 entries)", body: "no marker" },
    ]);
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "reports/migrations/audit-staging.json": { content: auditJson("staging", "2026-07-01T00:00:00Z") } } },
      gh: (_repo, args) => (args[0] === "issue" ? proc.ok(issues) : proc.ok("[]")),
    });
    const batch = await migrationAuditSource.collect(ctx);
    const sig = batch.signals.filter(isMigrationAuditSignal)[0]!;
    expect(sig.openDriftIssueCount).toBe(2);
    expect(sig.rollingIssueNumber).toBe(410); // staging marker; prod's unmarked dupe doesn't match
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("drift-issue lane: gh unavailable → nulls + degraded (never a fake zero)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "reports/migrations/audit-prod.json": { content: auditJson("prod", "2026-07-02T00:00:00Z") } } },
      gh: () => proc.unauth(),
    });
    const batch = await migrationAuditSource.collect(ctx);
    const sig = batch.signals.filter(isMigrationAuditSignal)[0]!;
    expect(sig.openDriftIssueCount).toBeNull();
    expect(sig.rollingIssueNumber).toBeNull();
    const fresh = batch.repoFreshness[0]!;
    expect(fresh.freshness).toBe("stale");
    expect(fresh.errors.some((e) => e.code === "gh_unauthenticated")).toBe(true);
  });

  it("parseMigrationAudit is STRICT (fail-closed): count-shaped fields ok, missing/invalid counters or non-array entries fail the parse", () => {
    const full = (over: string) =>
      `{"target":"prod","entries":[],"orphan_tracker_rows":7,"unaudited_branch_files":[],"grant_surface_violations":[],"grant_surface_scanned":42${over}}`;
    expect(parseMigrationAudit(full(""))?.orphanTrackerRows).toBe(7); // count-shaped ok
    expect(parseMigrationAudit('{"target":"prod","entries":[]}')).toBeNull(); // missing counters = unwitnessed
    expect(parseMigrationAudit(full(',"x":1').replace('"orphan_tracker_rows":7', '"orphan_tracker_rows":-1'))).toBeNull(); // negative
    expect(parseMigrationAudit(full("").replace('"grant_surface_scanned":42', '"grant_surface_scanned":4.2'))).toBeNull(); // fractional
    expect(parseMigrationAudit(full("").replace('"entries":[]', '"entries":{}'))).toBeNull(); // non-array entries
    expect(parseMigrationAudit('{"entries":[]}')).toBeNull();
    expect(parseMigrationAudit("[]")).toBeNull();
    expect(parseMigrationAudit("nope")).toBeNull();
  });

  it("a corrupt NEWEST audit stales the older same-target file (filename-lifted target) — never live-green past a broken newest", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "reports/migrations/audit-staging-ok.json": { content: auditJson("staging", "2026-06-01T00:00:00Z"), mtime: "2026-06-01T00:00:00.000Z" },
          "reports/migrations/audit-staging-corrupt.json": { content: "{not json", mtime: "2026-07-01T00:00:00.000Z" },
        },
      },
    });
    const batch = await migrationAuditSource.collect(ctx);
    const sig = batch.signals.filter(isMigrationAuditSignal)[0]!;
    expect(sig.freshness).toBe("stale"); // the fold maps this to lastGood: true
  });
});
