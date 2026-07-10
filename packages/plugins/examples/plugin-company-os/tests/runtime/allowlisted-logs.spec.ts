/**
 * COS-11 T0 — the §3.3b allowlisted out-of-repo log reader: enum-only path
 * resolution (the three sanctioned logs, nothing else), bounded TAIL reads
 * (truncation is a NORMAL flagged state, text may begin mid-line), absence →
 * null (never a throw), unknown repoKey → null.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowlistedLogPath, readTailBounded } from "../../src/runtime/makeCollectionContext.js";
import type { SignalLogger } from "../../src/contracts/collection-context.js";

const quietLogger: SignalLogger = { debug() {}, info() {}, warn() {}, error() {} };

let home: string;
let repoRoot: string;
const absByKey = new Map<string, string>();

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cos-logs-home-"));
  repoRoot = await mkdtemp(join(tmpdir(), "cos-logs-repo-"));
  absByKey.set("juice-bar", repoRoot);
  await mkdir(join(home, ".claude", "logs"), { recursive: true });
  await mkdir(join(repoRoot, ".claude", "logs"), { recursive: true });
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(repoRoot, { recursive: true, force: true });
});

describe("allowlistedLogPath — enum-only resolution", () => {
  it("maps the three sanctioned keys and NOTHING else exists on the seam", () => {
    expect(allowlistedLogPath({ log: "codex_invocations" }, absByKey, home)).toBe(
      join(home, ".claude", "logs", "codex-invocations.ndjson"),
    );
    expect(allowlistedLogPath({ log: "cannons_runs" }, absByKey, home)).toBe(
      join(home, ".claude", "logs", "cannons-runs.log"),
    );
    expect(allowlistedLogPath({ log: "repo_guardrails", repoKey: "juice-bar" }, absByKey, home)).toBe(
      join(repoRoot, ".claude", "logs", "guardrails.ndjson"),
    );
  });

  it("an unknown repoKey resolves to null (no path fabricated)", () => {
    expect(allowlistedLogPath({ log: "repo_guardrails", repoKey: "nope" }, absByKey, home)).toBeNull();
  });
});

describe("readTailBounded", () => {
  it("small file: full text, truncated=false, mtime present", async () => {
    const p = join(home, ".claude", "logs", "cannons-runs.log");
    await writeFile(p, "run1 sha1 ship repo1 t1\nrun2 sha2 ship repo2 t2\n", "utf-8");
    const r = await readTailBounded(p, 4096, quietLogger);
    expect(r).not.toBeNull();
    expect(r!.truncated).toBe(false);
    expect(r!.text.split("\n").filter(Boolean)).toHaveLength(2);
    expect(Date.parse(r!.mtime)).toBeGreaterThan(0);
  });

  it("oversize file: LAST maxBytes only, truncated=true, first line may be partial (row 7)", async () => {
    const p = join(home, ".claude", "logs", "codex-invocations.ndjson");
    // Fixed-width 51-byte rows (incl. newline) that are JSON EDGE-TO-EDGE (no
    // padding whitespace), so a non-multiple maxBytes PROVABLY slices mid-JSON.
    const line = (i: number) => `{"row":${String(i).padStart(2, "0")},"pad":"${"x".repeat(31)}"}`;
    const lines = Array.from({ length: 50 }, (_, i) => line(i));
    await writeFile(p, lines.join("\n") + "\n", "utf-8");
    const r = await readTailBounded(p, 275, quietLogger); // 275 = 5.39 rows
    expect(r).not.toBeNull();
    expect(r!.truncated).toBe(true);
    expect(Buffer.byteLength(r!.text, "utf8")).toBeLessThanOrEqual(275);
    const got = r!.text.split("\n").filter((l) => l.trim() !== "");
    // The first slice line is a PARTIAL row (starts mid-JSON) — consumers drop it.
    expect(() => JSON.parse(got[0])).toThrow();
    // The LAST complete rows survive intact.
    expect(JSON.parse(got[got.length - 1]).row).toBe(49);
  });

  it("absence → null (NORMAL, not an error)", async () => {
    const r = await readTailBounded(join(home, ".claude", "logs", "never-written.log"), 1024, quietLogger);
    expect(r).toBeNull();
  });
});
