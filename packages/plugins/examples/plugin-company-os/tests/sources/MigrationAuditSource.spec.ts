import { describe, expect, it } from "vitest";
import { migrationAuditSource, parseMigrationAudit } from "../../src/sources/MigrationAuditSource.js";
import { isMigrationAuditSignal, type MigrationAuditSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

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

  it("parseMigrationAudit tolerates count-shaped fields and rejects non-object/missing-target", () => {
    expect(parseMigrationAudit('{"target":"prod","entries":[],"orphan_tracker_rows":7}')?.orphanTrackerRows).toBe(7);
    expect(parseMigrationAudit('{"entries":[]}')).toBeNull();
    expect(parseMigrationAudit("[]")).toBeNull();
    expect(parseMigrationAudit("nope")).toBeNull();
  });
});
