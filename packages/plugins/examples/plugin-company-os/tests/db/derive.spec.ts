import { describe, expect, it } from "vitest";
import { deriveForCompany, type DeriveDeps } from "../../src/derive.js";
import { acquireDeriveLock, ensureBoardRow, readBoardState, readGitState } from "../../src/db/cache.js";
import { resolveTaxonomy } from "../../src/contracts/projects.js";
import { FakeDb } from "../test-utils/fake-db.js";
import { makeFixtureContext, gitTable, proc } from "../fixtures/context.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";
import type { CollectionContext } from "../../src/contracts/collection-context.js";

const CO = "company-uuid";

/** A fixture context where git reports one in-progress worktree branch for the scoped repo. */
function ctxFor(scopeRepo: string | null): CollectionContext {
  return makeFixtureContext({
    // `company` must be present for PrefixRegistrySource (gated to it) to emit taxonomy.
    repos: [
      { repo: "juice-bar", available: true },
      { repo: "company", available: true },
    ],
    scopeRepo,
    registry: [{ prefix: "OB", family: "Onboarding", l1_system: "JB", l2_subsystem: "Onboarding", description: "", is_generic: false, created_at: null }],
    git: gitTable({
      "worktree list --porcelain": proc.ok("worktree /r/wt\nHEAD a\nbranch refs/heads/claude/OB-01\n"),
    }),
  });
}

function depsFor(db: FakeDb, nowMs = Date.parse("2026-06-23T12:00:00Z")): DeriveDeps {
  return {
    db,
    makeContext: async (scopeRepo) => ctxFor(scopeRepo),
    now: () => nowMs,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    resolveTaxonomy: async () => taxonomyFixture(),
  };
}

describe("deriveForCompany", () => {
  it("derives, writes the board, and records a successful run", async () => {
    const db = new FakeDb();
    const result = await deriveForCompany(depsFor(db), CO, "schedule", null, "owner-1");
    expect(result).toMatchObject({ ok: true, skipped: false });
    const board = await readBoardState(db, CO);
    expect(board?.chips.find((c) => c.id === "OB-01")?.column).toBe("in_progress");
    expect(db.runs.at(-1)).toMatchObject({ trigger: "schedule", ok: true });
  });

  // --- COS-8f T5: §4.1 rows 1-2 pinned as contract tests -------------------

  it("row 1: a second derive while the lock is held no-ops WITH the documented log line", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "other-owner", 120_000, Date.parse("2026-06-23T12:00:00Z"));
    const infoLines: string[] = [];
    const deps = depsFor(db);
    const result = await deriveForCompany(
      { ...deps, logger: { debug() {}, info(msg: string) { infoLines.push(msg); }, warn() {}, error() {} } },
      CO,
      "manual",
      null,
      "owner-2",
    );
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(infoLines.some((l) => l.includes("derive skipped") && l.includes("lock held"))).toBe(true);
  });

  it("row 2 (DECIDED): a scoped refresh racing the cron derive YIELDS — no second concurrent derive, no queue", async () => {
    // Decision (spec §4.1 row 2): the loser of the lock race yields with
    // skipped:true rather than queueing — the winning derive persists fresh
    // data for every repo, so a queued re-run would only duplicate work. The
    // UI's miss-retry (row 3) covers the "my repo wasn't in that sweep" case.
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    // The cron ("schedule") derive holds the lock…
    await acquireDeriveLock(db, CO, "cron-owner", 120_000, Date.parse("2026-06-23T12:00:00Z"));
    // …and a scoped refresh-board ("hook", scopeRepo) races it.
    const scoped = await deriveForCompany(depsFor(db), CO, "hook", "juice-bar", "refresh-owner");
    expect(scoped).toMatchObject({ ok: true, skipped: true, error: null });
    // The scoped loser wrote NOTHING (no run recorded, no projections).
    expect(db.runs.filter((r) => r.trigger === "hook")).toHaveLength(0);
  });

  it("no-ops when the lock is already held (concurrent derive)", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "other", 120_000, Date.parse("2026-06-23T12:00:00Z"));
    const result = await deriveForCompany(depsFor(db), CO, "manual", null, "owner-2");
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it("releases the lock after a successful derive (a later derive can acquire)", async () => {
    const db = new FakeDb();
    await deriveForCompany(depsFor(db), CO, "schedule", null, "owner-1");
    // Lock should be free now.
    expect(await acquireDeriveLock(db, CO, "next", 120_000, Date.parse("2026-06-23T13:00:00Z"))).toBe(true);
  });

  it("records a failed run + releases the lock when the context factory throws", async () => {
    const db = new FakeDb();
    const deps: DeriveDeps = { ...depsFor(db), makeContext: async () => { throw new Error("boom"); } };
    const result = await deriveForCompany(deps, CO, "schedule", null, "owner-x");
    expect(result.ok).toBe(false);
    expect(db.runs.at(-1)).toMatchObject({ ok: false });
    expect(await acquireDeriveLock(db, CO, "after", 120_000, Date.parse("2026-06-23T14:00:00Z"))).toBe(true);
  });

  it("threads the resolved taxonomy (incl. its raw-dup-basename diagnostic) into the projections (v5)", async () => {
    const db = new FakeDb();
    // resolveTaxonomy is given RAW roots (with a dup basename), proving the diagnostic
    // survives — resolving from ctx.repos (basename-collapsed) would lose it.
    const deps: DeriveDeps = {
      ...depsFor(db),
      resolveTaxonomy: async () => resolveTaxonomy(["/a/company", "/b/company", "/p/juice-bar"]),
    };
    await deriveForCompany(deps, CO, "schedule", null, "owner-d");
    const gitState = await readGitState(db, CO);
    expect(gitState?.taxonomy.diagnostics.some((d) => d.code === "duplicate_basename")).toBe(true);
  });
});
