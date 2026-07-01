import { describe, expect, it } from "vitest";
import { readSkillContent, type SkillContentDeps } from "../src/skill-content-read.js";
import { makeSkillId, type SkillEntryV1, type SkillsCatalogV1 } from "../src/contracts/skills-catalog.js";
import type { ContainedFileRead } from "../src/report-content-read.js";

const CO = "co-1";

function entry(over: Partial<SkillEntryV1> = {}): SkillEntryV1 {
  const checkoutKey = over.checkoutKey ?? "company";
  const relPath = over.relPath ?? "config/skills/review-cannons/SKILL.md";
  return {
    skillId: over.skillId ?? makeSkillId(checkoutKey, relPath),
    origin: over.origin ?? "company",
    collection: over.collection ?? "core",
    checkoutKey,
    relPath,
    slug: over.slug ?? "review-cannons",
    name: over.name ?? "review-cannons",
    summary: over.summary ?? "14-pass review",
    sizeBytes: over.sizeBytes ?? 42,
    mtime: over.mtime ?? "2026-06-20T00:00:00.000Z",
  };
}

function catalogOf(...entries: SkillEntryV1[]): SkillsCatalogV1 {
  return {
    schemaVersion: 1,
    derivedAt: "2026-06-20T00:00:00.000Z",
    total: entries.length,
    diagnostics: [],
    origins: [
      { origin: "company", label: "Company", count: entries.length, collections: [{ collection: "core", label: "Workflow & Infra", skills: entries }] },
      { origin: "plugins", label: "Installed plugins", count: 0, collections: [] },
    ],
  };
}

function depsFor(catalog: SkillsCatalogV1 | null, readFile: SkillContentDeps["readFile"], resolvable = true): SkillContentDeps {
  return {
    readIndex: async () => catalog,
    readFile,
    checkoutResolvable: () => resolvable,
  };
}

const okRead = (content: string): ContainedFileRead => ({ content, sizeBytes: content.length, mtime: "2026-06-20T00:00:00.000Z" });

describe("readSkillContent", () => {
  it("serves an indexed skill body as ok markdown", async () => {
    const e = entry();
    const deps = depsFor(catalogOf(e), async () => okRead("# review-cannons\n\nbody"));
    const out = await readSkillContent(deps, CO, e.skillId);
    expect(out.status).toBe("ok");
    expect(out.renderMode).toBe("markdown");
    expect(out.content).toContain("review-cannons");
    expect(out.title).toBe("review-cannons");
    expect(out.artifactType).toBeNull();
    expect(out.docStatus).toBeNull();
  });

  it("refuses an id not in the catalog (index gate)", async () => {
    const deps = depsFor(catalogOf(entry()), async () => okRead("x"));
    const out = await readSkillContent(deps, CO, makeSkillId("company", "config/skills/ghost/SKILL.md"));
    expect(out.status).toBe("not_indexed");
    expect(out.content).toBeNull();
  });

  it("refuses an empty skillId", async () => {
    const deps = depsFor(catalogOf(entry()), async () => okRead("x"));
    const out = await readSkillContent(deps, CO, "");
    expect(out.status).toBe("not_found");
  });

  it("link-only for an unsupported extension", async () => {
    const e = entry({ relPath: "config/skills/x/SKILL.png", skillId: makeSkillId("company", "config/skills/x/SKILL.png") });
    const deps = depsFor(catalogOf(e), async () => okRead("binary"));
    const out = await readSkillContent(deps, CO, e.skillId);
    expect(out.status).toBe("unsupported_type");
  });

  it("not_found when the checkout no longer resolves (removed plugin root)", async () => {
    const e = entry({ checkoutKey: "skillroot:gone", origin: "plugins", collection: "x" });
    const deps = depsFor(catalogOf(e), async () => okRead("x"), false);
    const out = await readSkillContent(deps, CO, e.skillId);
    expect(out.status).toBe("not_found");
  });

  it("maps an oversize read to too_large", async () => {
    const e = entry();
    const deps: SkillContentDeps = {
      readIndex: async () => catalogOf(e),
      readFile: async () => okRead("x".repeat(50)),
      checkoutResolvable: () => true,
      maxBytes: 10,
    };
    const out = await readSkillContent(deps, CO, e.skillId);
    expect(out.status).toBe("too_large");
  });

  it("maps a containment violation to denied", async () => {
    const e = entry();
    const deps = depsFor(catalogOf(e), async () => {
      throw new Error("path escapes workspace: config/skills/review-cannons/SKILL.md");
    });
    const out = await readSkillContent(deps, CO, e.skillId);
    expect(out.status).toBe("denied");
  });
});
