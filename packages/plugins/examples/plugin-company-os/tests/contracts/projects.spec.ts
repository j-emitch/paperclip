import { describe, expect, it } from "vitest";
import {
  deriveDefaultTaxonomy,
  findProjectGroup,
  parseProjectTaxonomyV1,
  projectKeyForRepo,
  resolveTaxonomy,
  safeParseProjectTaxonomyV1,
  sanitizeRepoRoots,
  type ProjectGroupV1,
} from "../../src/contracts/index.js";

const root = (key: string, prefix = "/Users/joe/projects") => `${prefix}/${key}`;

/** Joe's five live repos as raw roots (the §5.7 default fixture). */
const FIVE_ROOTS = [
  root("company"),
  root("juice-bar"),
  root("arc-scraper"),
  root("viacava-arts"),
  root("paperclip"),
];

function group(
  key: string,
  kind: ProjectGroupV1["kind"],
  order: number,
  repos: ProjectGroupV1["repos"],
): ProjectGroupV1 {
  return { key, displayName: key, kind, order, repos };
}

describe("resolveTaxonomy — derived default (no projects)", () => {
  it("yields the §5.7 table for Joe's known basenames", () => {
    const tax = resolveTaxonomy(FIVE_ROOTS);
    expect(tax.source).toBe("derived-default");
    expect(tax.groups.map((g) => g.key)).toEqual(["company", "juice-bar", "viacava-arts", "paperclip"]);

    const company = tax.groups.find((g) => g.key === "company")!;
    expect(company.kind).toBe("company");

    const jb = tax.groups.find((g) => g.key === "juice-bar")!;
    expect(jb.kind).toBe("product");
    expect(jb.repos).toEqual([
      { repoKey: "juice-bar", role: "primary" },
      { repoKey: "arc-scraper", role: "dependency" },
    ]);

    expect(tax.groups.find((g) => g.key === "viacava-arts")!.kind).toBe("side_project");
    expect(tax.groups.find((g) => g.key === "paperclip")!.kind).toBe("platform");
    expect(() => parseProjectTaxonomyV1(tax)).not.toThrow();
  });

  it("an unrecognized root becomes its own product group keyed by basename", () => {
    const tax = resolveTaxonomy([root("company"), root("cambora")]);
    const cambora = tax.groups.find((g) => g.key === "cambora");
    expect(cambora?.kind).toBe("product");
    expect(cambora?.displayName).toBe("Cambora");
    expect(cambora?.repos).toEqual([{ repoKey: "cambora", role: "primary" }]);
  });

  it("a known group with zero assigned repos is simply omitted (not an error)", () => {
    const tax = resolveTaxonomy([root("company")]);
    expect(tax.groups.map((g) => g.key)).toEqual(["company"]);
    expect(tax.diagnostics).toHaveLength(0);
  });

  it("a dependency-only default group promotes the first assigned repo to primary", () => {
    const tax = resolveTaxonomy([root("company"), root("arc-scraper")]); // juice-bar absent
    const jb = tax.groups.find((g) => g.key === "juice-bar")!;
    expect(jb.repos).toEqual([{ repoKey: "arc-scraper", role: "primary" }]);
    expect(tax.diagnostics.some((d) => d.code === "primary_promoted")).toBe(true);
  });

  it("an empty projects array is treated as derived-default (back-compat)", () => {
    expect(resolveTaxonomy([root("company")], []).source).toBe("derived-default");
  });
});

describe("resolveTaxonomy — merged (partial projects)", () => {
  it("takes configured groups first, then auto-adds every unassigned root", () => {
    const tax = resolveTaxonomy(
      [root("company"), root("juice-bar"), root("arc-scraper"), root("viacava-arts")],
      [group("company", "company", 0, [{ repoKey: "company", role: "primary" }])],
    );
    expect(tax.source).toBe("merged");
    expect(tax.groups.map((g) => g.key)).toEqual(
      expect.arrayContaining(["company", "juice-bar", "arc-scraper", "viacava-arts"]),
    );
    expect(tax.diagnostics.some((d) => d.code === "auto_added_group")).toBe(true);
  });

  it("drops a projects repoKey that is not in repoRoots, with a diagnostic", () => {
    const tax = resolveTaxonomy(
      [root("company")],
      [
        group("company", "company", 0, [
          { repoKey: "company", role: "primary" },
          { repoKey: "ghost", role: "dependency" },
        ]),
      ],
    );
    expect(tax.groups.find((g) => g.key === "company")!.repos.map((r) => r.repoKey)).toEqual(["company"]);
    expect(tax.diagnostics.some((d) => d.code === "repo_not_assigned")).toBe(true);
  });

  it("drops a group left with zero assigned repos (empty-group)", () => {
    const tax = resolveTaxonomy(
      [root("company")],
      [
        group("company", "company", 0, [{ repoKey: "company", role: "primary" }]),
        group("empty", "product", 1, [{ repoKey: "nope", role: "primary" }]),
      ],
    );
    expect(tax.groups.some((g) => g.key === "empty")).toBe(false);
    expect(tax.diagnostics.some((d) => d.code === "empty_group")).toBe(true);
  });

  it("keeps the first of a duplicate group key, drops the later with a diagnostic", () => {
    const tax = resolveTaxonomy(
      [root("company"), root("juice-bar")],
      [
        { key: "dup", displayName: "First", kind: "company", order: 0, repos: [{ repoKey: "company", role: "primary" }] },
        { key: "dup", displayName: "Second", kind: "product", order: 1, repos: [{ repoKey: "juice-bar", role: "primary" }] },
      ],
    );
    const dups = tax.groups.filter((g) => g.key === "dup");
    expect(dups).toHaveLength(1);
    expect(dups[0]!.displayName).toBe("First");
    expect(tax.diagnostics.some((d) => d.code === "duplicate_group_key")).toBe(true);
  });

  it("resolves a repo assigned to two groups first-wins by order", () => {
    const tax = resolveTaxonomy(
      [root("juice-bar")],
      [
        group("a", "product", 1, [{ repoKey: "juice-bar", role: "primary" }]),
        group("b", "product", 0, [{ repoKey: "juice-bar", role: "primary" }]),
      ],
    );
    expect(findProjectGroup(tax, "juice-bar")?.key).toBe("b"); // order 0 wins
    expect(tax.groups.some((g) => g.key === "a")).toBe(false); // a left empty → dropped
    expect(tax.diagnostics.some((d) => d.code === "duplicate_repo_assignment")).toBe(true);
  });

  it("promotes the first member to primary when a configured group has no assigned primary", () => {
    const tax = resolveTaxonomy(
      [root("arc-scraper")],
      [group("jb", "product", 0, [{ repoKey: "juice-bar", role: "primary" }, { repoKey: "arc-scraper", role: "dependency" }])],
    );
    const jb = tax.groups.find((g) => g.key === "jb")!;
    expect(jb.repos).toEqual([{ repoKey: "arc-scraper", role: "primary" }]);
    expect(tax.diagnostics.some((d) => d.code === "primary_promoted")).toBe(true);
  });
});

describe("sanitizeRepoRoots + duplicate basenames", () => {
  it("detects duplicate basenames from the raw roots (pre-basename-map) and drops one", () => {
    const { roots, diagnostics } = sanitizeRepoRoots([root("juice-bar", "/a"), root("juice-bar", "/b"), root("company")]);
    expect(roots).toHaveLength(2); // one juice-bar kept + company
    expect(diagnostics.some((d) => d.code === "duplicate_basename")).toBe(true);
  });

  it("resolveTaxonomy surfaces the duplicate-basename diagnostic and yields one group", () => {
    const tax = resolveTaxonomy([root("juice-bar", "/a"), root("juice-bar", "/b"), root("company")]);
    expect(tax.diagnostics.some((d) => d.code === "duplicate_basename")).toBe(true);
    expect(tax.groups.filter((g) => g.key === "juice-bar")).toHaveLength(1);
  });
});

describe("projectKeyForRepo + findProjectGroup", () => {
  const tax = resolveTaxonomy([root("company"), root("juice-bar"), root("arc-scraper")]);

  it("resolves an assigned repo (incl. a dependency) to its family key", () => {
    expect(projectKeyForRepo(tax, "juice-bar")).toBe("juice-bar");
    expect(projectKeyForRepo(tax, "arc-scraper")).toBe("juice-bar"); // dependency → Juice Bar family
    expect(projectKeyForRepo(tax, "company")).toBe("company");
  });

  it("falls back to the company/default group for an unassigned repo", () => {
    expect(findProjectGroup(tax, "unknown-repo")).toBeNull();
    expect(projectKeyForRepo(tax, "unknown-repo")).toBe("company");
  });
});

describe("deriveDefaultTaxonomy + parse rejection", () => {
  it("deriveDefaultTaxonomy returns groups + diagnostics directly", () => {
    const { groups } = deriveDefaultTaxonomy(["company", "juice-bar", "arc-scraper"]);
    expect(groups.map((g) => g.key)).toEqual(["company", "juice-bar"]);
  });

  it("a malformed taxonomy (bad kind) is rejected by safeParse", () => {
    const bad = { schemaVersion: 1, source: "derived-default", diagnostics: [], groups: [{ key: "x", displayName: "X", kind: "bogus", repos: [], order: 0 }] };
    expect(safeParseProjectTaxonomyV1(bad).success).toBe(false);
  });
});
