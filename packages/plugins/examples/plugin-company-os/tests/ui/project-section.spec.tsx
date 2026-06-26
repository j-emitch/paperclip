import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSection } from "../../src/ui/shared/ProjectSection.js";
import type { ProjectGroupV1 } from "../../src/contracts/projects.js";

const GROUP: ProjectGroupV1 = {
  key: "juice-bar",
  displayName: "Juice Bar",
  kind: "product",
  repos: [
    { repoKey: "juice-bar", role: "primary" },
    { repoKey: "arc-scraper", role: "dependency" },
  ],
  order: 1,
  note: "the primary product + its data pipeline",
};

describe("ProjectSection", () => {
  it("renders the taxonomy-driven header (name · kind · note · count) + member content", () => {
    const html = renderToStaticMarkup(
      <ProjectSection group={GROUP} count={3}>
        <div>branch-row-content</div>
      </ProjectSection>,
    );
    expect(html).toContain("Juice Bar");
    expect(html).toContain("Product"); // kind label
    expect(html).toContain("the primary product"); // note
    expect(html).toContain("3"); // count
    expect(html).toContain("branch-row-content");
  });

  it("renders a calm 0-state when empty (show-0-counts, never a crash)", () => {
    const html = renderToStaticMarkup(
      <ProjectSection group={GROUP} isEmpty emptyLabel="All branches merged & clean." />,
    );
    expect(html).toContain("Juice Bar"); // header still shows
    expect(html).toContain("All branches merged &amp; clean.");
    expect(html).not.toContain("branch-row-content");
  });
});
