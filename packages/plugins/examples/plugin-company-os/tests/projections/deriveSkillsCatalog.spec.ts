import { describe, expect, it } from "vitest";
import { deriveSkillsCatalog } from "../../src/projections/deriveSkillsCatalog.js";
import type { SignalBatch, SignalBundle } from "../../src/contracts/WorkSignalSource.js";
import type { SkillSignal } from "../../src/contracts/signals.js";
import { makeSkillId, type SkillOrigin } from "../../src/contracts/skills-catalog.js";

const NOW = 1_700_000_000_000;

function skill(origin: SkillOrigin, collection: string, slug: string, checkoutKey = origin === "company" ? "company" : "skillroot:cache"): SkillSignal {
  const relPath = origin === "company" ? `config/skills/${slug}/SKILL.md` : `${collection}/1.0.0/skills/${slug}/SKILL.md`;
  return {
    kind: "skill",
    source: "skills",
    repo: checkoutKey,
    path: relPath,
    confidence: "high",
    freshness: "live",
    errors: [],
    skillId: makeSkillId(checkoutKey, relPath),
    origin,
    collection,
    checkoutKey,
    relPath,
    slug,
    name: slug,
    summary: `${slug} summary`,
    mtime: "2026-06-20T00:00:00.000Z",
    sizeBytes: 100,
    indexFingerprint: `fp-${slug}`,
  };
}

function bundle(signals: SkillSignal[], repoFreshness: SignalBatch["repoFreshness"] = []): SignalBundle {
  return { collectedAt: NOW, batches: [{ source: "skills", collectedAt: NOW, signals, repoFreshness }] };
}

describe("deriveSkillsCatalog", () => {
  it("folds signals into origin → collection → skill, company first, both origins always present", () => {
    const cat = deriveSkillsCatalog(
      bundle([
        skill("company", "core", "review-cannons"),
        skill("company", "design", "animate"),
        skill("plugins", "superpowers", "brainstorm"),
      ]),
      NOW,
    );

    expect(cat.origins.map((o) => o.origin)).toEqual(["company", "plugins"]); // company is the star, first
    expect(cat.total).toBe(3);

    const company = cat.origins[0]!;
    expect(company.label).toBe("Company");
    expect(company.count).toBe(2);
    // company collections pinned: core before design
    expect(company.collections.map((c) => c.collection)).toEqual(["core", "design"]);
    expect(company.collections[0]!.label).toBe("Workflow & Infra");
    expect(company.collections[1]!.label).toBe("Design & UX");

    const plugins = cat.origins[1]!;
    expect(plugins.label).toBe("Installed plugins");
    expect(plugins.collections[0]!.label).toBe("Superpowers");
  });

  it("emits an empty plugins section (show-0) when no plugin skills exist", () => {
    const cat = deriveSkillsCatalog(bundle([skill("company", "core", "spec-author")]), NOW);
    const plugins = cat.origins.find((o) => o.origin === "plugins")!;
    expect(plugins).toBeDefined();
    expect(plugins.count).toBe(0);
    expect(plugins.collections).toEqual([]);
  });

  it("dedupes by skillId (first signal wins)", () => {
    const dup = skill("company", "core", "review-cannons");
    const cat = deriveSkillsCatalog(bundle([dup, { ...dup, name: "SHOULD-NOT-WIN" }]), NOW);
    expect(cat.total).toBe(1);
    expect(cat.origins[0]!.collections[0]!.skills[0]!.name).toBe("review-cannons");
  });

  it("sorts skills by name within a collection", () => {
    const cat = deriveSkillsCatalog(
      bundle([skill("company", "core", "zeta"), skill("company", "core", "alpha"), skill("company", "core", "mu")]),
      NOW,
    );
    expect(cat.origins[0]!.collections[0]!.skills.map((s) => s.name)).toEqual(["alpha", "mu", "zeta"]);
  });

  it("surfaces a SkillsSource truncation as a warn diagnostic", () => {
    const b = bundle(
      [skill("company", "core", "a")],
      [{ repo: "company", freshness: "live", lastOkAt: null, errors: [{ code: "truncated", message: "skill index truncated at 1000 for company", degraded: false }] }],
    );
    const cat = deriveSkillsCatalog(b, NOW);
    expect(cat.diagnostics.some((d) => d.code === "skill_index_truncated" && d.level === "warn")).toBe(true);
  });
});
