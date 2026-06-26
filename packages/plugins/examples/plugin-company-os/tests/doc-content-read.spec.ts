import { describe, expect, it } from "vitest";
import { readDocContent, type DocContentDeps } from "../src/doc-content-read.js";
import { deriveDocIndex } from "../src/projections/deriveDocIndex.js";
import { makeDocId } from "../src/contracts/doc-index.js";
import { NOW, bundleOf, docSignal } from "./fixtures/signals.js";
import { taxonomyFixture } from "./fixtures/taxonomy.js";

const INDEX = deriveDocIndex(
  bundleOf([
    docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
    docSignal("specs/y.md", { repo: "company", checkoutId: "worktree:aaa", checkoutKey: "company::wt::aaa", worktreeName: "wt1" }),
    docSignal("art.png", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
  ]),
  NOW,
  taxonomyFixture(),
);

const MAIN = makeDocId("company", "main", "specs/x.md");
const WT = makeDocId("company", "worktree:aaa", "specs/y.md");
const PNG = makeDocId("company", "main", "art.png");

function deps(over: Partial<DocContentDeps> = {}): DocContentDeps {
  return {
    readIndex: async () => INDEX,
    readFile: async (_checkoutKey, relPath) => ({ content: `# body of ${relPath}`, sizeBytes: 12, mtime: "2026-06-23T00:00:00.000Z" }),
    checkoutResolvable: (key) => key === "company" || key === "company::wt::aaa",
    ...over,
  };
}

describe("readDocContent", () => {
  it("reads an indexed doc by docId via its checkoutKey (ReportContentV1 ok)", async () => {
    const r = await readDocContent(deps(), "co", MAIN);
    expect(r.status).toBe("ok");
    expect(r.repo).toBe("company");
    expect(r.relPath).toBe("specs/x.md");
    expect(r.content).toContain("specs/x.md");
    expect(r.artifactType).toBeNull(); // a doc has no ArtifactType
  });

  it("resolves a worktree doc through its pseudo checkoutKey", async () => {
    const r = await readDocContent(deps(), "co", WT);
    expect(r.status).toBe("ok");
    expect(r.relPath).toBe("specs/y.md");
  });

  it("refuses a docId not in the index (not_indexed) — the index gate", async () => {
    expect((await readDocContent(deps(), "co", "not-a-real-id")).status).toBe("not_indexed");
  });

  it("a removed worktree / dropped dup-basename root (checkoutKey unresolvable) → not_found", async () => {
    const r = await readDocContent(deps({ checkoutResolvable: () => false }), "co", WT);
    expect(r.status).toBe("not_found");
  });

  it("a containment violation → denied (sanitized, relative path only)", async () => {
    const r = await readDocContent(
      deps({ readFile: async () => { throw new Error("path escapes workspace: specs/x.md"); } }),
      "co",
      MAIN,
    );
    expect(r.status).toBe("denied");
    expect(r.content).toBeNull();
  });

  it("a non-renderable extension → unsupported_type", async () => {
    expect((await readDocContent(deps(), "co", PNG)).status).toBe("unsupported_type");
  });
});
