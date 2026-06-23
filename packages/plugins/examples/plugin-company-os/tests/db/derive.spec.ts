import { describe, expect, it } from "vitest";
import { deriveForCompany, type DeriveDeps } from "../../src/derive.js";
import { acquireDeriveLock, ensureBoardRow, readBoardState } from "../../src/db/cache.js";
import { FakeDb } from "../test-utils/fake-db.js";
import { makeFixtureContext, gitTable, proc } from "../fixtures/context.js";
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
});
