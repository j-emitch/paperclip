import { describe, expect, it } from "vitest";
import { deriveDocIndex } from "../../src/projections/deriveDocIndex.js";
import { parseDocIndexV1 } from "../../src/contracts/doc-index.js";
import { NOW, artifact, bundleOf, docSignal } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const TAX = taxonomyFixture();
const docsIn = (di: ReturnType<typeof deriveDocIndex>, groupKey: string, type: string) =>
  di.groups.find((g) => g.group.key === groupKey)?.types.find((t) => t.type === type)?.docs ?? [];

describe("deriveDocIndex", () => {
  it("folds DocSignals + main-checkout ArtifactSignals into a project→type→doc tree", () => {
    const di = deriveDocIndex(
      bundleOf([
        docSignal("specs/x.md", { repo: "company", docType: "spec" }),
        docSignal("docs/superpowers/plans/p.md", { repo: "juice-bar", docType: "plan" }),
        artifact("reports/reviews/r.md", { repo: "company", artifactType: "cannons" }),
      ]),
      NOW,
      TAX,
    );
    expect(docsIn(di, "company", "spec").some((d) => d.relPath === "specs/x.md")).toBe(true);
    expect(docsIn(di, "company", "review").some((d) => d.relPath === "reports/reviews/r.md")).toBe(true);
    expect(docsIn(di, "juice-bar", "plan").some((d) => d.relPath === "docs/superpowers/plans/p.md")).toBe(true);
    expect(() => parseDocIndexV1(di)).not.toThrow();
  });

  it("dedups by docId — a main-checkout artifact wins over a DocsSource main duplicate", () => {
    const di = deriveDocIndex(
      bundleOf([
        docSignal("specs/x.md", { repo: "company", checkoutId: "main", title: "From DocsSource" }),
        artifact("specs/x.md", { repo: "company", artifactType: "spec", title: "From ArtifactSource" }),
      ]),
      NOW,
      TAX,
    );
    const x = docsIn(di, "company", "spec").filter((d) => d.relPath === "specs/x.md");
    expect(x).toHaveLength(1);
    expect(x[0]!.title).toBe("From ArtifactSource"); // artifact wins
  });

  it("keeps worktree copies distinct (different checkoutId → different docId)", () => {
    const di = deriveDocIndex(
      bundleOf([
        docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
        docSignal("specs/x.md", { repo: "company", checkoutId: "worktree:aaa", checkoutKey: "company::wt::aaa", worktreeName: "wt1", branch: "feat/x" }),
      ]),
      NOW,
      TAX,
    );
    const x = docsIn(di, "company", "spec").filter((d) => d.relPath === "specs/x.md");
    expect(x).toHaveLength(2);
    expect(x.some((d) => d.provenance === "worktree" && d.worktreeName === "wt1")).toBe(true);
  });

  it("lands an unresolvable repo in Company / Reviews with a diagnostic (never dropped)", () => {
    const di = deriveDocIndex(bundleOf([docSignal("specs/y.md", { repo: "ghost-repo", docType: "spec" })]), NOW, TAX);
    expect(docsIn(di, "company", "review").some((d) => d.repoKey === "ghost-repo")).toBe(true);
    expect(di.diagnostics.some((d) => d.code === "unresolved_repo")).toBe(true);
  });

  it("every taxonomy group renders (calm 0-state when empty — show-0-counts)", () => {
    const di = deriveDocIndex(bundleOf([docSignal("specs/x.md", { repo: "company" })]), NOW, TAX);
    expect(di.groups.map((g) => g.group.key)).toEqual(["company", "juice-bar", "viacava-arts", "paperclip"]);
    expect(di.groups.find((g) => g.group.key === "paperclip")!.types).toEqual([]);
  });
});

describe("deriveDocIndex — C1 §2.3 spine", () => {
  it("threads owner/lastUpdated/statusVerifiedAt/description into entries (artifact path = honest nulls)", () => {
    const di = deriveDocIndex(
      bundleOf([
        docSignal("specs/x.md", { repo: "company", docType: "spec", status: "active", owner: "joe", lastUpdated: "2026-07-01", statusVerifiedAt: "2026-07-02", description: "One-liner." }),
        artifact("reports/reviews/r.md", { repo: "company", artifactType: "cannons" }),
      ]),
      NOW,
      TAX,
    );
    const spec = docsIn(di, "company", "spec").find((d) => d.relPath === "specs/x.md")!;
    expect(spec.owner).toBe("joe");
    expect(spec.lastUpdated).toBe("2026-07-01");
    expect(spec.statusVerifiedAt).toBe("2026-07-02");
    expect(spec.description).toBe("One-liner.");
    const review = docsIn(di, "company", "review").find((d) => d.relPath === "reports/reviews/r.md")!;
    expect(review.owner).toBeNull();
    expect(review.description).toBeNull();
    expect(() => parseDocIndexV1(di)).not.toThrow(); // v2 schema round-trip
  });

  it("rolls status-without-verification into ONE info diagnostic per repo (never per-doc flood)", () => {
    const di = deriveDocIndex(
      bundleOf([
        docSignal("specs/a.md", { repo: "company", status: "active" }), // unverified
        docSignal("specs/b.md", { repo: "company", status: "shipped" }), // unverified
        docSignal("specs/c.md", { repo: "company", status: "shipped", statusVerifiedAt: "2026-07-01" }), // verified
        docSignal("specs/d.md", { repo: "juice-bar", status: "draft" }), // unverified, other repo
        docSignal("specs/e.md", { repo: "juice-bar" }), // no status at all — not counted
      ]),
      NOW,
      TAX,
    );
    const unverified = di.diagnostics.filter((d) => d.code === "status_unverified");
    expect(unverified).toHaveLength(2); // one per repo
    expect(unverified.every((d) => d.level === "info")).toBe(true); // info tier — rail-only, never tints
    expect(unverified.find((d) => d.repo === "company")?.message).toContain("2 docs");
    expect(unverified.find((d) => d.repo === "juice-bar")?.message).toContain("1 doc ");
  });
});
