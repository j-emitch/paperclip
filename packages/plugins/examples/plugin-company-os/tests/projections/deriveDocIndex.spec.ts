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
