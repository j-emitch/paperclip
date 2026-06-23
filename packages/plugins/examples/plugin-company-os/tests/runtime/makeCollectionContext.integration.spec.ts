/**
 * Integration test for the COS-0c Node adapter — the ONE side-effectful module.
 * Exercises the real `git` runner (execFile, no shell), the real workspace walk
 * + containment, the real SHA-256 hasher, and the registry dynamic-import
 * against a throwaway git repo. Hermetic (no network, no machine-specific
 * paths); `gh` is the only piece left to the live 0d wiring.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCollectionContext } from "../../src/runtime/makeCollectionContext.js";
import { silentLogger } from "../fixtures/context.js";

const execFileAsync = promisify(execFile);

let parent: string;
let companyRoot: string;

beforeAll(async () => {
  parent = await mkdtemp(path.join(tmpdir(), "cos-adapter-"));
  companyRoot = path.join(parent, "company");
  await mkdir(path.join(companyRoot, "specs"), { recursive: true });
  await mkdir(path.join(companyRoot, "config", "lib"), { recursive: true });
  await mkdir(path.join(companyRoot, "secret"), { recursive: true });

  await writeFile(path.join(companyRoot, "specs", "COS-0.md"), "---\ntype: spec\nstatus: planned\n---\nbody");
  await writeFile(path.join(companyRoot, "secret", "passwd"), "top secret");
  // A target OUTSIDE the workspace root (under the temp parent) — readText must reject a symlink to it.
  await writeFile(path.join(parent, "outside.txt"), "outside the workspace");
  await writeFile(path.join(companyRoot, "config", "prefix-registry.json"), JSON.stringify([
    { prefix: "COS", family: "Company OS", l1_system: "Company", l2_subsystem: "Company-OS", description: "x", is_generic: false, created_at: "2026-06-23" },
  ]));
  // Minimal canonical parser stand-in (the real one is company/config/lib/prefix-registry.mjs).
  await writeFile(
    path.join(companyRoot, "config", "lib", "prefix-registry.mjs"),
    `import { readFileSync } from "node:fs";\nexport function loadRegistry(jsonPath) { return JSON.parse(readFileSync(jsonPath, "utf-8")); }\n`,
  );
  // A symlink escaping the workspace root — readText must reject it.
  await symlink(path.join(parent, "outside.txt"), path.join(companyRoot, "specs", "escape.md")).catch(() => {});

  await execFileAsync("git", ["init", "-q"], { cwd: companyRoot });
}, 30_000);

afterAll(async () => {
  if (parent) await rm(parent, { recursive: true, force: true });
});

describe("makeCollectionContext (real fs + git)", () => {
  it("resolves a git repo as available and runs git via fixed argv", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    expect(ctx.repos).toEqual([{ repo: "company", available: true }]);
    const wt = await ctx.git.run("company", ["worktree", "list", "--porcelain"]);
    expect(wt.code).toBe(0);
    expect(wt.stdout).toContain("worktree ");
  });

  it("lists workspace files by glob and reads contained files", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const files = await ctx.fs.list("company", ["specs/**/*.md"]);
    expect(files.map((f) => f.relPath)).toContain("specs/COS-0.md");
    const text = await ctx.fs.readText("company", "specs/COS-0.md");
    expect(text).toContain("type: spec");
  });

  it("rejects path traversal (incl. .. that normalizes back in-root) and symlink escape", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    await expect(ctx.fs.readText("company", "../passwd")).rejects.toThrow();
    await expect(ctx.fs.readText("company", "specs/../config/prefix-registry.json")).rejects.toThrow(/escapes workspace/);
    await expect(ctx.fs.readText("company", "specs/escape.md")).rejects.toThrow(/escapes workspace/);
  });

  it("stat mirrors readText containment — an escaping symlink stats as null", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    expect(await ctx.fs.stat("company", "specs/escape.md")).toBeNull();
    expect(await ctx.fs.stat("company", "../passwd")).toBeNull();
    expect((await ctx.fs.stat("company", "specs/COS-0.md"))?.relPath).toBe("specs/COS-0.md");
  });

  it("the walk never surfaces a symlink as a listed file", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const files = await ctx.fs.list("company", ["specs/**/*.md"]);
    expect(files.some((f) => f.relPath === "specs/escape.md")).toBe(false);
  });

  it("hashes content with real SHA-256 (64 hex chars, content-sensitive)", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const a = ctx.hash("hello");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.hash("hello")).toBe(a);
    expect(ctx.hash("world")).not.toBe(a);
  });

  it("loads the registry through the canonical parser module", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const { entries, errors } = await ctx.registry.load();
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.prefix)).toEqual(["COS"]);
  });

  it("an unknown repo key degrades (no throw) on the git runner", async () => {
    const ctx = await makeCollectionContext({ repoRoots: [companyRoot], scopeRepo: null, logger: silentLogger });
    const r = await ctx.git.run("nope", ["status"]);
    expect(r.code).toBeNull();
    expect(r.stderr).toContain("unknown repo");
  });

  it("a non-git directory is reported unavailable", async () => {
    const plain = path.join(parent, "arc-scraper");
    await mkdir(plain, { recursive: true });
    const ctx = await makeCollectionContext({ repoRoots: [plain], scopeRepo: null, logger: silentLogger });
    expect(ctx.repos[0]).toEqual({ repo: "arc-scraper", available: false });
  });
});
