/**
 * The docs-viewer containment core (spec §7 + §11 C1) against a REAL temp dir —
 * the security-critical half of `report-content`. Proves traversal, symlink
 * escape, and oversize are rejected, that a legitimate UTF-8 file reads through,
 * and that no absolute path leaks (the returned stat is workspace-relative).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  containedResolve,
  realpathContained,
  readContainedText,
  statContained,
  repoKey,
  absByKeyFromRoots,
} from "../../src/runtime/workspace-fs.js";

let root = "";
let outside = "";

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), "cos-wsfs-"));
  root = join(base, "repo");
  outside = join(base, "outside");
  await mkdir(join(root, "specs"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, "specs", "doc.md"), "# Hello\n\nUTF-8 ✓ café résumé 日本語\n", "utf-8");
  await writeFile(join(outside, "secret.md"), "TOP SECRET", "utf-8");
  // A symlink INSIDE the repo that points OUTSIDE it.
  await symlink(join(outside, "secret.md"), join(root, "specs", "escape.md"));
});

afterAll(async () => {
  if (root) await rm(join(root, ".."), { recursive: true, force: true });
});

describe("workspace-fs containment", () => {
  it("resolves a legitimate relative path under the root", () => {
    const abs = containedResolve(root, "specs/doc.md");
    expect(abs).toBe(join(root, "specs", "doc.md"));
  });

  it("rejects absolute paths", () => {
    expect(containedResolve(root, "/etc/passwd")).toBeNull();
  });

  it("rejects any `..` segment (even one that would normalize back inside)", () => {
    expect(containedResolve(root, "../outside/secret.md")).toBeNull();
    expect(containedResolve(root, "specs/../../escape")).toBeNull();
    expect(containedResolve(root, "specs/../specs/doc.md")).toBeNull();
  });

  it("rejects the empty path", () => {
    expect(containedResolve(root, "")).toBeNull();
  });

  it("realpathContained returns null for a symlink that escapes the root", async () => {
    const abs = join(root, "specs", "escape.md");
    expect(await realpathContained(root, abs)).toBeNull();
  });

  it("reads a legitimate UTF-8 file and returns a relative stat (no absolute path)", async () => {
    const { content, stat } = await readContainedText(root, "specs/doc.md", 1_000_000);
    expect(content).toContain("café résumé 日本語");
    expect(stat.relPath).toBe("specs/doc.md");
    expect(stat.relPath).not.toContain(root); // never leaks the absolute path
    expect(stat.sizeBytes).toBeGreaterThan(0);
    expect(stat.isSymlink).toBe(false);
  });

  it("rejects a traversal read", async () => {
    await expect(readContainedText(root, "../outside/secret.md", 1_000_000)).rejects.toThrow(/escapes workspace/);
  });

  it("rejects a symlink-escape read (never serves the outside file)", async () => {
    await expect(readContainedText(root, "specs/escape.md", 1_000_000)).rejects.toThrow(/escapes workspace/);
  });

  it("rejects an oversize read with a size-cap error", async () => {
    await expect(readContainedText(root, "specs/doc.md", 4)).rejects.toThrow(/size cap/);
  });

  it("statContained returns a relative stat for a real file, null for missing/escape", async () => {
    const ok = await statContained(root, "specs/doc.md");
    expect(ok?.relPath).toBe("specs/doc.md");
    expect(await statContained(root, "specs/missing.md")).toBeNull();
    expect(await statContained(root, "../outside/secret.md")).toBeNull();
    expect(await statContained(root, "specs/escape.md")).toBeNull(); // symlink escape
  });

  it("repoKey + absByKeyFromRoots map basenames to roots", () => {
    expect(repoKey("/a/b/juice-bar/")).toBe("juice-bar");
    const map = absByKeyFromRoots(["/x/juice-bar", "/y/company"]);
    expect(map.get("juice-bar")).toBe("/x/juice-bar");
    expect(map.get("company")).toBe("/y/company");
  });
});
