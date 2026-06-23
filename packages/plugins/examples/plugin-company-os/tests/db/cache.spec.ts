import { describe, expect, it } from "vitest";
import {
  acquireDeriveLock,
  assertNamespace,
  ensureBoardRow,
  loadSourceVersions,
  readBoardState,
  releaseDeriveLock,
  saveSourceVersions,
  writeProjections,
} from "../../src/db/cache.js";
import { COS_DB_NAMESPACE } from "../../src/db/namespace.js";
import { collectAndProject } from "../../src/collect-and-project.js";
import type { SourceVersion } from "../../src/db/scoped-merge.js";
import { FakeDb } from "../test-utils/fake-db.js";
import { NOW, bundleOf, taxon, work } from "../fixtures/signals.js";

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
  );

  it("writes validated projections and reads the board back", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await writeProjections(db, CO, projections);
    const board = await readBoardState(db, CO);
    expect(board?.chips.find((c) => c.id === "COS-0")?.column).toBe("in_progress");
  });

  it("rejects an invalid projection on write (validate-before-write)", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    const bad = { ...projections, board: { ...projections.board, columns: ["nope"] } };
    // @ts-expect-error: deliberately malformed board for the negative test
    await expect(writeProjections(db, CO, bad)).rejects.toThrow();
  });

  it("a wrong-schema-version row reads as null (forces re-derive)", async () => {
    const db = new FakeDb();
    await ensureBoardRow(db, CO);
    await writeProjections(db, CO, projections);
    db.board.get(CO)!.schemaVersion = 99; // simulate an old snapshot
    expect(await readBoardState(db, CO)).toBeNull();
  });

  it("missing row reads as null", async () => {
    expect(await readBoardState(new FakeDb(), "absent")).toBeNull();
  });
});

describe("cache — source versions round-trip", () => {
  it("saves and loads per-(source, repo) slices", async () => {
    const db = new FakeDb();
    const versions: SourceVersion[] = [
      { source: "git-work", repo: "company", signals: [], freshness: "live", lastOkAt: "t" },
      { source: "git-work", repo: "juice-bar", signals: [], freshness: "stale", lastOkAt: null },
    ];
    await saveSourceVersions(db, CO, versions);
    const loaded = await loadSourceVersions(db, CO);
    expect(loaded.map((v) => `${v.source}:${v.repo}:${v.freshness}`).sort()).toEqual([
      "git-work:company:live",
      "git-work:juice-bar:stale",
    ]);
  });
});
