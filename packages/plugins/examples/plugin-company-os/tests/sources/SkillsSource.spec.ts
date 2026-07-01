import { describe, expect, it } from "vitest";
import { skillsSource } from "../../src/sources/SkillsSource.js";
import { isSkillSignal, type SkillSignal } from "../../src/contracts/signals.js";
import { MAX_SKILLS_PER_ROOT, type SkillRootRef } from "../../src/contracts/skills-catalog.js";
import { makeFixtureContext, type FixtureFs } from "../fixtures/context.js";
import { mergeScopedBundle, type SourceVersion } from "../../src/db/scoped-merge.js";
import type { SignalBundle } from "../../src/contracts/WorkSignalSource.js";

const SKILL_MD = (name: string, desc: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n\nbody…`;

const DESIGN_ROOT: SkillRootRef = { key: "skillroot:company:skills", origin: "company", collection: "design" };
const PLUGIN_ROOT: SkillRootRef = { key: "skillroot:plugins:cache", origin: "plugins", collection: null };

/** Company core (config/skills in the repo) + design skills at their out-of-repo root. */
const COMPANY_FILES: FixtureFs = {
  company: {
    "config/skills/review-cannons/SKILL.md": { content: SKILL_MD("review-cannons", "14-pass pre-push review") },
    "config/skills/spec-author/SKILL.md": { content: SKILL_MD("spec-author", "Author a spec end to end") },
    // a non-skill markdown that must NOT be picked up
    "config/skills/README.md": { content: "# not a skill" },
    "docs/whatever.md": { content: "# unrelated" },
  },
  "skillroot:company:skills": {
    "animate/SKILL.md": { content: SKILL_MD("animate", "Add purposeful motion") },
    "adapt/SKILL.md": { content: SKILL_MD("adapt", "Responsive breakpoints") },
  },
};

function skills(sigs: readonly { kind: string }[]): SkillSignal[] {
  return (sigs as readonly SkillSignal[]).filter(isSkillSignal);
}

describe("SkillsSource — company origin", () => {
  it("indexes config/skills (core) in-repo + the design root (out-of-repo) as one company origin", async () => {
    const ctx = makeFixtureContext({ files: COMPANY_FILES, skillRoots: [DESIGN_ROOT] });
    const batch = await skillsSource.collect(ctx);
    const found = skills(batch.signals);

    expect(found).toHaveLength(4);
    const byName = new Map(found.map((s) => [s.name, s]));
    expect(byName.get("review-cannons")).toMatchObject({ origin: "company", collection: "core", checkoutKey: "company" });
    expect(byName.get("spec-author")).toMatchObject({ origin: "company", collection: "core" });
    // design skills come from the out-of-repo root but are still origin=company AND
    // carry repo="company" (the SLICE, not the read-key) so a scoped company refresh
    // keeps them (codex A/B P1); checkoutKey stays the read-key so skill-content reads
    // the file at its real out-of-repo path.
    expect(byName.get("animate")).toMatchObject({ origin: "company", collection: "design", repo: "company", checkoutKey: "skillroot:company:skills" });
    expect(byName.get("adapt")).toMatchObject({ origin: "company", collection: "design", repo: "company" });
    expect(byName.get("review-cannons")?.summary).toBe("14-pass pre-push review");
    expect(byName.get("animate")?.slug).toBe("animate");
    expect(found.some((s) => s.relPath.endsWith("README.md"))).toBe(false);
  });

  it("still marks the company repo LIVE when the design root is absent (core-only)", async () => {
    const ctx = makeFixtureContext({ files: COMPANY_FILES }); // no skillRoots
    const batch = await skillsSource.collect(ctx);
    const company = batch.repoFreshness.find((r) => r.repo === "company");
    expect(company?.freshness).toBe("live");
    expect(skills(batch.signals).map((s) => s.collection).sort()).toEqual(["core", "core"]);
  });
});

describe("SkillsSource — plugins origin", () => {
  const PLUGIN_FILES: FixtureFs = {
    ...COMPANY_FILES,
    "skillroot:plugins:cache": {
      "superpowers/5.0.7/skills/brainstorm/SKILL.md": { content: SKILL_MD("brainstorm", "Explore before building") },
      "vercel/0.44.0/skills/deploy/SKILL.md": { content: SKILL_MD("deploy", "Ship to Vercel") },
      // codex plugin nested under a REVISION hash — collection must be the plugin slug, not the hash
      "openai-curated/codex-security/3fdeeb49/skills/triage/SKILL.md": { content: SKILL_MD("triage", "Triage a finding") },
    },
  };

  it("scans plugin roots as origin=plugins, collection = plugin slug (version AND revision skipped)", async () => {
    const ctx = makeFixtureContext({ files: PLUGIN_FILES, skillRoots: [DESIGN_ROOT, PLUGIN_ROOT] });
    const batch = await skillsSource.collect(ctx);
    const plugins = skills(batch.signals).filter((s) => s.origin === "plugins");
    const byName = new Map(plugins.map((s) => [s.name, s]));

    expect(plugins).toHaveLength(3);
    expect(byName.get("brainstorm")).toMatchObject({ collection: "superpowers", checkoutKey: "skillroot:plugins:cache" });
    expect(byName.get("deploy")).toMatchObject({ collection: "vercel" });
    // the hash 3fdeeb49 is skipped → codex-security, not "3fdeeb49"
    expect(byName.get("triage")).toMatchObject({ collection: "codex-security" });
  });

  it("skips plugin roots on a SCOPED refresh (last-good preserved by the merge)", async () => {
    const ctx = makeFixtureContext({ files: PLUGIN_FILES, skillRoots: [DESIGN_ROOT, PLUGIN_ROOT], scopeRepo: "juice-bar" });
    const batch = await skillsSource.collect(ctx);
    // Scoped to a non-company repo → neither company (core+design) nor plugin skills re-collected.
    expect(skills(batch.signals)).toHaveLength(0);
  });

  it("re-scans company (core + design) but NOT plugins on a company-scoped refresh", async () => {
    const ctx = makeFixtureContext({ files: PLUGIN_FILES, skillRoots: [DESIGN_ROOT, PLUGIN_ROOT], scopeRepo: "company" });
    const found = skills((await skillsSource.collect(ctx)).signals);
    expect(found.every((s) => s.origin === "company")).toBe(true);
    expect(found.some((s) => s.collection === "design")).toBe(true);
    // Every company-scope signal (core AND out-of-repo design) carries repo="company"
    // === scopeRepo, so the scoped merge + persistence keep the fresh scan instead of
    // dropping it as an off-scope slice and leaving stale last-good (codex A/B P1).
    expect(found.every((s) => s.repo === "company")).toBe(true);
    // ...and the design read-key survives on checkoutKey for skill-content reads.
    expect(found.find((s) => s.collection === "design")?.checkoutKey).toBe("skillroot:company:skills");
  });
});

describe("SkillsSource — safety", () => {
  it("truncates at MAX_SKILLS_PER_ROOT with a non-degraded diagnostic, never a silent drop", async () => {
    const many: Record<string, { content: string }> = {};
    for (let i = 0; i < MAX_SKILLS_PER_ROOT + 5; i++) {
      many[`config/skills/skill-${i}/SKILL.md`] = { content: SKILL_MD(`skill-${i}`, "x") };
    }
    const ctx = makeFixtureContext({ files: { company: many } });
    const batch = await skillsSource.collect(ctx);
    expect(skills(batch.signals)).toHaveLength(MAX_SKILLS_PER_ROOT);
    const company = batch.repoFreshness.find((r) => r.repo === "company");
    const trunc = company?.errors.find((e) => e.code === "truncated");
    expect(trunc).toBeDefined();
    expect(trunc?.degraded).toBe(false); // a cap, not a failed read → stays LIVE
    expect(company?.freshness).toBe("live");
  });
});

describe("SkillsSource — scoped refresh survives the merge (derive-level, codex A/B P1)", () => {
  it("keeps freshly-scanned company DESIGN skills through a scoped company merge", async () => {
    const ctx = makeFixtureContext({ files: COMPANY_FILES, skillRoots: [DESIGN_ROOT], scopeRepo: "company" });
    const fresh = await skillsSource.collect(ctx);
    const freshBundle: SignalBundle = { collectedAt: fresh.collectedAt, batches: [fresh] };
    // A prior last-good where the company skills slice is STALE + empty — the pre-fix
    // symptom (fresh design skills dropped by the scope filter, stale last-good kept).
    const lastGood: SourceVersion[] = [{ source: "skills", repo: "company", signals: [], freshness: "stale", lastOkAt: null }];

    const merged = mergeScopedBundle(freshBundle, lastGood, "company");
    const mergedSkills = skills(merged.batches.flatMap((b) => b.signals));

    // The fresh design skills survive (repo="company" === scopeRepo) rather than being
    // filtered out as an off-scope slice — before the slice fix they carried the read-key
    // `skillroot:company:skills`, failed the `s.repo === scopeRepo` filter, and vanished.
    expect(mergedSkills.some((s) => s.name === "animate" && s.collection === "design")).toBe(true);
    expect(mergedSkills.some((s) => s.name === "adapt")).toBe(true);
    expect(mergedSkills.some((s) => s.collection === "core")).toBe(true); // core kept too
  });
});
