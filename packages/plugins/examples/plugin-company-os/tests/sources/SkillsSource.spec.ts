import { describe, expect, it } from "vitest";
import { skillsSource } from "../../src/sources/SkillsSource.js";
import { isSkillSignal, type SkillSignal } from "../../src/contracts/signals.js";
import { MAX_SKILLS_PER_ROOT } from "../../src/contracts/skills-catalog.js";
import { makeFixtureContext, type FixtureFs } from "../fixtures/context.js";

const SKILL_MD = (name: string, desc: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n\nbody…`;

/** Company skills: a real `config/skills` skill + a `.agents/skills` design skill. */
const COMPANY_FILES: FixtureFs = {
  company: {
    "config/skills/review-cannons/SKILL.md": { content: SKILL_MD("review-cannons", "14-pass pre-push review") },
    "config/skills/spec-author/SKILL.md": { content: SKILL_MD("spec-author", "Author a spec end to end") },
    ".agents/skills/animate/SKILL.md": { content: SKILL_MD("animate", "Add purposeful motion") },
    // a non-skill markdown that must NOT be picked up
    "config/skills/README.md": { content: "# not a skill" },
    "docs/whatever.md": { content: "# unrelated" },
  },
};

function skills(sigs: readonly { kind: string }[]): SkillSignal[] {
  return (sigs as readonly SkillSignal[]).filter(isSkillSignal);
}

describe("SkillsSource — company origin", () => {
  it("indexes config/skills (core) + .agents/skills (design), head-only, right origin/collection", async () => {
    const ctx = makeFixtureContext({ files: COMPANY_FILES });
    const batch = await skillsSource.collect(ctx);
    const found = skills(batch.signals);

    expect(found).toHaveLength(3);
    const byName = new Map(found.map((s) => [s.name, s]));
    expect(byName.get("review-cannons")).toMatchObject({ origin: "company", collection: "core", checkoutKey: "company" });
    expect(byName.get("spec-author")).toMatchObject({ origin: "company", collection: "core" });
    expect(byName.get("animate")).toMatchObject({ origin: "company", collection: "design" });
    // summary comes from frontmatter description
    expect(byName.get("review-cannons")?.summary).toBe("14-pass pre-push review");
    // slug is the skill's directory basename
    expect(byName.get("animate")?.slug).toBe("animate");
    // README.md and unrelated docs are not skills
    expect(found.some((s) => s.relPath.endsWith("README.md"))).toBe(false);
  });

  it("marks the company repo LIVE and emits no plugin signals when no skillRoots are set", async () => {
    const ctx = makeFixtureContext({ files: COMPANY_FILES });
    const batch = await skillsSource.collect(ctx);
    const company = batch.repoFreshness.find((r) => r.repo === "company");
    expect(company?.freshness).toBe("live");
    expect(skills(batch.signals).every((s) => s.origin === "company")).toBe(true);
  });
});

describe("SkillsSource — plugins origin", () => {
  const PLUGIN_FILES: FixtureFs = {
    ...COMPANY_FILES,
    "skillroot:cache": {
      "superpowers/5.0.7/skills/brainstorm/SKILL.md": { content: SKILL_MD("brainstorm", "Explore before building") },
      "vercel/0.44.0/skills/deploy/SKILL.md": { content: SKILL_MD("deploy", "Ship to Vercel") },
    },
  };

  it("scans configured skill roots as origin=plugins, collection = plugin slug (version skipped)", async () => {
    const ctx = makeFixtureContext({ files: PLUGIN_FILES, skillRoots: ["skillroot:cache"] });
    const batch = await skillsSource.collect(ctx);
    const plugins = skills(batch.signals).filter((s) => s.origin === "plugins");
    const byName = new Map(plugins.map((s) => [s.name, s]));

    expect(plugins).toHaveLength(2);
    expect(byName.get("brainstorm")).toMatchObject({ collection: "superpowers", checkoutKey: "skillroot:cache" });
    expect(byName.get("deploy")).toMatchObject({ collection: "vercel" });
  });

  it("skips plugin roots on a SCOPED refresh (last-good preserved by the merge)", async () => {
    const ctx = makeFixtureContext({ files: PLUGIN_FILES, skillRoots: ["skillroot:cache"], scopeRepo: "juice-bar" });
    const batch = await skillsSource.collect(ctx);
    // Scoped to a non-company repo → neither company nor plugin skills re-collected.
    expect(skills(batch.signals)).toHaveLength(0);
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
