/**
 * Pure Reports view-model — faceted filtering + sorting + counts. Runs the real
 * golden `ArtifactIndexV1` through `buildReportsView` and asserts the visible
 * list, the facet counts, and the cross-filter narrowing behave per spec §7.
 */

import { describe, expect, it } from "vitest";
import {
  ALL,
  ARTIFACT_TYPE_LABELS,
  baseName,
  buildReportsView,
  EMPTY_FILTER,
  selectionKey,
  UNSET_FACET,
  type ReportsFilter,
} from "../../src/ui/reports/reports-view-model.js";
import { goldenArtifactIndex } from "./fixtures/reports.js";

const filter = (over: Partial<ReportsFilter> = {}): ReportsFilter => ({ ...EMPTY_FILTER, ...over });

describe("buildReportsView", () => {
  const index = goldenArtifactIndex();

  it("lists every entry newest-first with no filter", () => {
    const view = buildReportsView(index, filter());
    expect(view.total).toBe(index.entries.length);
    expect(view.shown).toBe(index.entries.length);
    // Sorted by mtime desc — the first entry is the most recent.
    const mtimes = view.entries.map((e) => e.mtime);
    const sorted = [...mtimes].sort((a, b) => b.localeCompare(a));
    expect(mtimes).toEqual(sorted);
  });

  it("filters by type and narrows the shown count", () => {
    const view = buildReportsView(index, filter({ type: "cannons" }));
    expect(view.entries.every((e) => e.artifactType === "cannons")).toBe(true);
    expect(view.shown).toBeLessThan(view.total);
  });

  it("filters by repo and by prefix", () => {
    const byRepo = buildReportsView(index, filter({ repo: "juice-bar" }));
    expect(byRepo.entries.every((e) => e.repo === "juice-bar")).toBe(true);

    const byPrefix = buildReportsView(index, filter({ prefix: "COS" }));
    expect(byPrefix.entries.every((e) => e.prefix === "COS")).toBe(true);
  });

  it("buckets null system/prefix under the (none) facet and filters them", () => {
    const view = buildReportsView(index, filter());
    const noneFacet = view.prefixFacets.find((f) => f.value === UNSET_FACET);
    expect(noneFacet).toBeTruthy();
    const filtered = buildReportsView(index, filter({ prefix: UNSET_FACET }));
    expect(filtered.entries.every((e) => e.prefix === null)).toBe(true);
  });

  it("search matches title, path, and prefix (case-insensitive)", () => {
    const byTitle = buildReportsView(index, filter({ search: "kanban" }));
    expect(byTitle.shown).toBeGreaterThan(0);
    expect(byTitle.entries.every((e) => `${e.title ?? ""} ${e.relPath} ${e.prefix ?? ""}`.toLowerCase().includes("kanban"))).toBe(true);

    const noMatch = buildReportsView(index, filter({ search: "zzzznope" }));
    expect(noMatch.shown).toBe(0);
  });

  it("type facets always include an All chip and only present types, counted vs other filters", () => {
    const view = buildReportsView(index, filter({ repo: "company" }));
    const all = view.typeFacets.find((t) => t.value === ALL);
    expect(all?.count).toBe(view.entries.length); // All-chip count == shown for the active filter set
    // Every non-All facet is a real label.
    for (const f of view.typeFacets) {
      if (f.value !== ALL) expect(f.label).toBe(ARTIFACT_TYPE_LABELS[f.value]);
    }
  });

  it("cross-filter narrowing: selecting a repo updates the prefix facet counts", () => {
    const unfiltered = buildReportsView(index, filter());
    const scoped = buildReportsView(index, filter({ repo: "company" }));
    const totalPrefixCount = (v: ReturnType<typeof buildReportsView>) => v.prefixFacets.reduce((s, f) => s + f.count, 0);
    expect(totalPrefixCount(scoped)).toBeLessThanOrEqual(totalPrefixCount(unfiltered));
  });

  it("selectionKey + baseName are stable identity + filename helpers", () => {
    expect(selectionKey({ repo: "company", relPath: "a/b.md" })).toBe("company::a/b.md");
    expect(baseName("docs/specs/x.md")).toBe("x.md");
    expect(baseName("README.md")).toBe("README.md");
  });
});
