/**
 * SSR coverage for the Skills tab view — first spec for this surface (it predated
 * the states-spec discipline). Pins the B4 shared-freshness treatment and the
 * header counts; grows as the surface does.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsView } from "../../src/ui/skills/SkillsView.js";
import { flattenVisible, stepIndex } from "../../src/ui/skills/skills-view-model.js";
import type { SkillEntryV1, SkillsCatalogV1 } from "../../src/contracts/index.js";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const noop = () => {};

function catalog(): SkillsCatalogV1 {
  return {
    schemaVersion: 1,
    derivedAt: "2026-07-02T00:00:00.000Z",
    origins: [],
    total: 0,
    diagnostics: [],
  };
}

function render(c: SkillsCatalogV1): string {
  return renderToStaticMarkup(
    <SkillsView
      catalog={c}
      totalUnfiltered={c.total}
      selectedSkillId={null}
      onSelect={noop}
      query=""
      onQueryChange={noop}
      now={NOW}
      viewer={<div>viewer</div>}
    />,
  );
}

describe("Skills surface (B4)", () => {
  it("renders the shared SurfaceFreshnessBadge (was a hand-rolled 'as of' clock)", () => {
    const html = render(catalog());
    expect(html).toContain("Skills is live"); // derivedAt === NOW in the fixture
  });

  it("shows the 0-count header for an empty catalog", () => {
    const html = render(catalog());
    expect(html).toContain("0 skills");
  });
});

// ---- Keyboard nav + row affordances (the polish pass) -----------------------

function skill(over: Partial<SkillEntryV1> = {}): SkillEntryV1 {
  const slug = over.slug ?? "review-cannons";
  const checkoutKey = over.checkoutKey ?? "company";
  const relPath = over.relPath ?? `config/skills/${slug}/SKILL.md`;
  return {
    skillId: over.skillId ?? `["skill","${checkoutKey}","${relPath}"]`,
    origin: over.origin ?? "company",
    collection: over.collection ?? "core",
    checkoutKey,
    relPath,
    slug,
    name: over.name ?? slug,
    summary: over.summary ?? "14-pass review",
    sizeBytes: over.sizeBytes ?? 42,
    mtime: over.mtime ?? "2026-06-20T00:00:00.000Z",
  };
}

function catalogWith(...skills: SkillEntryV1[]): SkillsCatalogV1 {
  return {
    schemaVersion: 1,
    derivedAt: "2026-07-02T00:00:00.000Z",
    origins: skills.length
      ? [{ origin: "company", label: "Company", count: skills.length, collections: [{ collection: "core", label: "Workflow & Infra", skills }] }]
      : [],
    total: skills.length,
    diagnostics: [],
  };
}

function renderView(c: SkillsCatalogV1, selectedSkillId: string | null = null, query = ""): string {
  return renderToStaticMarkup(
    <SkillsView
      catalog={c}
      totalUnfiltered={c.total}
      selectedSkillId={selectedSkillId}
      onSelect={noop}
      query={query}
      onQueryChange={noop}
      now={NOW}
      viewer={<div>viewer</div>}
    />,
  );
}

describe("Skills surface -- keyboard nav + row affordances", () => {
  it("flattenVisible walks origins -> collections -> skills in render order", () => {
    const core = skill({ slug: "review-cannons", collection: "core" });
    const design = skill({ slug: "adapt", collection: "design" });
    const cat: SkillsCatalogV1 = {
      schemaVersion: 1,
      derivedAt: "2026-07-02T00:00:00.000Z",
      total: 2,
      diagnostics: [],
      origins: [
        {
          origin: "company",
          label: "Company",
          count: 2,
          collections: [
            { collection: "core", label: "Workflow & Infra", skills: [core] },
            { collection: "design", label: "Design & UX", skills: [design] },
          ],
        },
      ],
    };
    expect(flattenVisible(cat).map((s) => s.slug)).toEqual(["review-cannons", "adapt"]);
  });

  it("flattenVisible returns an empty list for an empty catalog", () => {
    expect(flattenVisible(catalogWith())).toEqual([]);
  });

  it("shows the '/' keyboard hint when the search box is idle + empty", () => {
    expect(renderView(catalogWith())).toContain("<kbd");
  });

  it("renders the reveal-arrow glyph on a row (not the always-present cos-fx CSS string)", () => {
    const html = renderView(catalogWith(skill({ slug: "review-cannons" })));
    expect(html).toContain("review-cannons");
    // Assert the actual arrow glyph, which only a rendered SkillRow emits. The class
    // name "cos-fx-row-go" lives in CockpitMotionStyles' CSS regardless, so matching
    // it would be tautological (present even for an empty catalog).
    expect(html).toContain("→");
  });

  it("emits no reveal-arrow glyph for an empty catalog (negative guard)", () => {
    expect(renderView(catalogWith())).not.toContain("→");
  });

  it("marks the selected skill row with aria-current", () => {
    const s = skill({ slug: "review-cannons" });
    expect(renderView(catalogWith(s), s.skillId)).toContain('aria-current="true"');
  });

  it("stepIndex clamps both ends and picks first/last from no selection", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0); // no selection, down -> first
    expect(stepIndex(-1, 3, -1)).toBe(2); // no selection, up -> last
    expect(stepIndex(0, 3, 1)).toBe(1); // step down
    expect(stepIndex(2, 3, 1)).toBe(2); // clamp at bottom (no wrap)
    expect(stepIndex(0, 3, -1)).toBe(0); // clamp at top (no wrap)
    expect(stepIndex(1, 3, -1)).toBe(0); // step up
    expect(stepIndex(0, 0, 1)).toBe(-1); // empty list
  });
});
