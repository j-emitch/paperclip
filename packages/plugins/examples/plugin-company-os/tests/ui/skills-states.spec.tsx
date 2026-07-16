/**
 * SSR coverage for the Skills tab view — first spec for this surface (it predated
 * the states-spec discipline). Pins the B4 shared-freshness treatment and the
 * header counts; grows as the surface does.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsView } from "../../src/ui/skills/SkillsView.js";
import type { SkillsCatalogV1 } from "../../src/contracts/index.js";

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
