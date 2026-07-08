import { describe, expect, it } from "vitest";
import {
  acquireDeriveLock,
  assertNamespace,
  ensureBoardRow,
  loadSourceVersions,
  PROJECTION_SPECS,
  readAgentSystem,
  readBoardState,
  readBuildAtlas,
  readOrientation,
  readRoutineHealth,
  releaseDeriveLock,
  replaceSourceVersions,
  writeProjections,
  readWorktreeBoard,
} from "../../src/db/cache.js";
import { BUILD_ATLAS_SCHEMA_VERSION } from "../../src/contracts/build-atlas.js";
import { COS_DB_NAMESPACE } from "../../src/db/namespace.js";
import { collectAndProject } from "../../src/collect-and-project.js";
import type { SourceVersion } from "../../src/db/scoped-merge.js";
import { FakeDb } from "../test-utils/fake-db.js";
import { NOW, agentSignal, bundleOf, taxon, work } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const CO = "company-uuid";

describe("cache — namespace guard", () => {
  it("accepts the canonical namespace and rejects a mismatch", () => {
    expect(() => assertNamespace(new FakeDb())).not.toThrow();
    expect(() => assertNamespace(new FakeDb("plugin_company_os_WRONG"))).toThrow(/namespace mismatch/);
  });
  it("the literal is exactly the host-derived value", () => {
    expect(COS_DB_NAMESPACE).toBe("plugin_company_os_cc959257d2");
  });
});

describe("cache — atomic derive lock (CAS)", () => {
  it("a second concurrent acquirer gets 0 rows; a stale lease is reclaimable", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    const t0 = NOW;
    expect(await acquireDeriveLock(db, CO, "A", 120_000, t0)).toBe(true);
    // B tries while A holds the lease → denied.
    expect(await acquireDeriveLock(db, CO, "B", 120_000, t0 + 1_000)).toBe(false);
    // After the lease expires, B reclaims it.
    expect(await acquireDeriveLock(db, CO, "B", 120_000, t0 + 200_000)).toBe(true);
  });

  it("reclaim is inclusive at exactly the expiry instant (<=)", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    expect(await acquireDeriveLock(db, CO, "A", 100, NOW)).toBe(true); // lease until NOW+100
    expect(await acquireDeriveLock(db, CO, "B", 100, NOW + 100)).toBe(true); // exactly at expiry → reclaimable
  });

  it("release frees the lock only for the owner", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "A", 120_000, NOW);
    await releaseDeriveLock(db, CO, "B"); // wrong owner — no-op
    expect(await acquireDeriveLock(db, CO, "C", 120_000, NOW + 1)).toBe(false);
    await releaseDeriveLock(db, CO, "A");
    expect(await acquireDeriveLock(db, CO, "C", 120_000, NOW + 2)).toBe(true);
  });
});

describe("cache — projection write/read round-trip + version gate", () => {
  const projections = collectAndProject(
    bundleOf([taxon("COS", "Company OS", "Company", "Company-OS"), work("COS-0", "in_progress", "branch_path", { repo: "company" })]),
    NOW,
    taxonomyFixture(),
  );

  class LeaseStolenAfterBoardWriteDb extends FakeDb {
    async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
      const result = await super.execute(sql, params);
      const compactSql = sql.replace(/\s+/g, " ");
      if (result.rowCount === 1 && compactSql.includes("cos_board_state") && compactSql.includes("SET snapshot = $2::jsonb")) {
        this.board.get(String(params[0]))!.lockOwner = "B";
      }
      return result;
    }
  }

  async function acquired(db: FakeDb, owner: string): Promise<void> {
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, owner, 120_000, NOW);
  }

  it("PROJECTION_SPECS covers every ProjectionSet field (registry can't silently drop a projection)", () => {
    // `projections` is a full ProjectionSet — its keys are the ground truth. The registry
    // the validate/upsert/read paths all loop MUST cover exactly those keys, or a projection
    // would be persisted/read by nobody — the both-append drop COS-5d-a guarded, now structural.
    expect(new Set(PROJECTION_SPECS.map((s) => s.key))).toEqual(new Set(Object.keys(projections)));
    // Exactly one fence (the board); every other projection is a lockless secondary.
    expect(PROJECTION_SPECS.filter((s) => !s.secondary).map((s) => s.key)).toEqual(["board"]);
    // Tables are unique — no two specs write the same row.
    expect(new Set(PROJECTION_SPECS.map((s) => s.table)).size).toBe(PROJECTION_SPECS.length);
  });

  it("writes validated projections (owner-fenced) and reads the board back", async () => {
    const db = new FakeDb();
    await acquired(db, "A");
    await writeProjections(db, CO, projections, "A");
    const board = await readBoardState(db, CO);
    expect(board?.chips.find((c) => c.id === "COS-0")?.column).toBe("in_progress");
    const agentSystem = await readAgentSystem(db, CO);
    expect(agentSystem?.agents).toEqual([]);
  });

  it("writes COS-1R routine and orientation snapshots at schema version 2", async () => {
    const db = new FakeDb();
    await acquired(db, "A");
    await writeProjections(db, CO, projections, "A");
    expect(db.routine.get(CO)?.schemaVersion).toBe(2);
    expect(db.orientation.get(CO)?.schemaVersion).toBe(2);
    expect((await readRoutineHealth(db, CO))?.schemaVersion).toBe(2);
    expect((await readOrientation(db, CO))?.schemaVersion).toBe(2);
  });

  it("rejects pre-COS-1R routine and orientation rows until re-derived", async () => {
    const db = new FakeDb();
    await acquired(db, "A");
    await writeProjections(db, CO, projections, "A");
    db.routine.get(CO)!.schemaVersion = 1;
    db.orientation.get(CO)!.schemaVersion = 1;
    expect(await readRoutineHealth(db, CO)).toBeNull();
    expect(await readOrientation(db, CO)).toBeNull();
  });

  it("a stale derive cannot overwrite after losing the lease (fenced write throws)", async () => {
    const db = new FakeDb();
    await acquired(db, "A"); // A holds the lease
    // B reclaims after expiry — now lock_owner = B.
    expect(await acquireDeriveLock(db, CO, "B", 120_000, NOW + 200_000)).toBe(true);
    // A resumes and tries to write — its fence (lock_owner = A) no longer matches.
    await expect(writeProjections(db, CO, projections, "A")).rejects.toThrow(/lease lost/);
  });

  it("throws if a secondary snapshot is fenced out after the board write", async () => {
    const db = new LeaseStolenAfterBoardWriteDb();
    await acquired(db, "A");
    await expect(writeProjections(db, CO, projections, "A")).rejects.toThrow(/secondary projection.*cos_artifact_index/);
  });

  it("rejects an invalid projection on write (validate-before-write)", async () => {
    const db = new FakeDb();
    await acquired(db, "A");
    const bad = { ...projections, board: { ...projections.board, columns: ["nope"] } };
    // @ts-expect-error: deliberately malformed board for the negative test
    await expect(writeProjections(db, CO, bad, "A")).rejects.toThrow();
  });

  it("a wrong-schema-version row reads as null (forces re-derive)", async () => {
    const db = new FakeDb();
    await acquired(db, "A");
    await writeProjections(db, CO, projections, "A");
    db.board.get(CO)!.schemaVersion = 99; // simulate an old snapshot
    expect(await readBoardState(db, CO)).toBeNull();
  });

  it("missing row reads as null", async () => {
    expect(await readBoardState(new FakeDb(), "absent")).toBeNull();
  });
});

describe("cache — COS-1R + COS-5 sibling snapshots (§8.1 both-append merge contract)", () => {
  // One derive must persist BOTH the COS-1R agent-system (mig 004) AND the COS-5
  // build-atlas (mig 005) secondary snapshots — the merge contract that guards
  // against either phase's after-fence upsert clobbering the other's row.
  const projections = collectAndProject(
    bundleOf([
      taxon("COS", "Company OS", "Company", "Company-OS"),
      work("COS-0", "shipped", "commit_scope", { repo: "company" }),
      agentSignal("cto", { displayName: "CTO" }),
    ]),
    NOW,
    taxonomyFixture(),
  );

  it("row 6 (COS-8c): a crash/lease-loss mid-write keeps the PREVIOUS complete worktree board for readers", async () => {
    // First derive lands a complete board (after-fence swap wrote it whole).
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "A", 120_000, NOW);
    await writeProjections(db, CO, projections, "A");
    const before = await readWorktreeBoard(db, CO);
    expect(before).not.toBeNull();

    // A second derive loses its lease at the FENCE (owner mismatch) — the write
    // throws before any secondary upsert, so readers keep the previous board.
    await expect(writeProjections(db, CO, projections, "NOT-THE-OWNER")).rejects.toThrow(/lease lost/);
    const after = await readWorktreeBoard(db, CO);
    expect(after).toEqual(before); // previous complete snapshot, not a torn write
  });

  it("round-trips both agent-system and build-atlas through one writeProjections", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "A", 120_000, NOW);
    await writeProjections(db, CO, projections, "A");

    // Both sibling rows exist and read back validated (neither clobbered the other).
    const agentSystem = await readAgentSystem(db, CO);
    const buildAtlas = await readBuildAtlas(db, CO);
    expect(agentSystem).not.toBeNull();
    expect(buildAtlas).not.toBeNull();
    // Assert the COS-1R PAYLOAD survived, not just a valid-but-empty row (codex-5d-a-B-P2):
    // a regression that wrote a default AgentSystemV1 over set.agentSystem would pass a
    // non-null check but fail this — proving build-atlas's upsert did not clobber the sibling.
    expect(agentSystem?.agents[0]?.displayName).toBe("CTO");
    // The build-atlas carries the COS family folded from the SAME bundle.
    expect(buildAtlas?.families.some((f) => f.prefix === "COS")).toBe(true);
    expect(buildAtlas?.schemaVersion).toBe(BUILD_ATLAS_SCHEMA_VERSION);
    expect(db.buildAtlas.get(CO)?.schemaVersion).toBe(BUILD_ATLAS_SCHEMA_VERSION);
  });

  it("a wrong-schema-version build-atlas row reads as null (forces re-derive)", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await acquireDeriveLock(db, CO, "A", 120_000, NOW);
    await writeProjections(db, CO, projections, "A");
    db.buildAtlas.get(CO)!.schemaVersion = 99;
    expect(await readBuildAtlas(db, CO)).toBeNull();
    // Its COS-1R sibling is unaffected by the build-atlas version bump.
    expect(await readAgentSystem(db, CO)).not.toBeNull();
  });
});

describe("cache — source versions replace semantics", () => {
  const versions: SourceVersion[] = [
    { source: "git-work", repo: "company", signals: [], freshness: "live", lastOkAt: "t" },
    { source: "git-work", repo: "juice-bar", signals: [], freshness: "stale", lastOkAt: null },
  ];

  it("full-sweep replace stores all slices; loads scoped to the company", async () => {
    const db = new FakeDb();
    await replaceSourceVersions(db, CO, null, versions);
    const loaded = await loadSourceVersions(db, CO);
    expect(loaded.map((v) => `${v.source}:${v.repo}:${v.freshness}`).sort()).toEqual([
      "git-work:company:live",
      "git-work:juice-bar:stale",
    ]);
  });

  it("full sweep purges a repo dropped from config (no stale resurrection)", async () => {
    const db = new FakeDb();
    await replaceSourceVersions(db, CO, null, versions); // company + juice-bar
    await replaceSourceVersions(db, CO, null, [versions[1]]); // juice-bar only — company dropped
    const loaded = await loadSourceVersions(db, CO);
    expect(loaded.map((v) => v.repo)).toEqual(["juice-bar"]);
  });

  it("scoped replace only touches the scoped repo's slices", async () => {
    const db = new FakeDb();
    await replaceSourceVersions(db, CO, null, versions);
    // A scoped juice-bar refresh replaces only juice-bar; company is preserved.
    await replaceSourceVersions(db, CO, "juice-bar", [
      { source: "git-work", repo: "juice-bar", signals: [], freshness: "live", lastOkAt: "t2" },
    ]);
    const loaded = await loadSourceVersions(db, CO);
    expect(loaded.find((v) => v.repo === "company")?.freshness).toBe("live");
    expect(loaded.find((v) => v.repo === "juice-bar")?.freshness).toBe("live");
  });

  it("does not leak another company's slices", async () => {
    const db = new FakeDb();
    await replaceSourceVersions(db, CO, null, versions);
    await replaceSourceVersions(db, "other-co", null, [versions[0]]);
    expect((await loadSourceVersions(db, CO)).length).toBe(2);
    expect((await loadSourceVersions(db, "other-co")).length).toBe(1);
  });
});
