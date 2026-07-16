import { describe, expect, it } from "vitest";
import {
  DOC_FRONTMATTER_SCAN_BYTES,
  DOC_INDEX_SCHEMA_VERSION,
  MAX_DOCS_PER_REPO,
  docIndexV1Schema,
  parseDocIndexV1,
  safeParseDocIndexV1,
} from "../../src/contracts/index.js";

const TAXONOMY = { schemaVersion: 1 as const, groups: [], source: "derived-default" as const, diagnostics: [] };
const GROUP = { key: "company", displayName: "Company", kind: "company" as const, repos: [{ repoKey: "company", role: "primary" as const }], order: 0 };

const MINIMAL = {
  schemaVersion: DOC_INDEX_SCHEMA_VERSION,
  derivedAt: "2026-06-23T00:00:00.000Z",
  sources: [],
  taxonomy: TAXONOMY,
  groups: [],
  diagnostics: [],
};

describe("DocIndexV1", () => {
  it("a minimal payload round-trips through parse", () => {
    expect(parseDocIndexV1(MINIMAL).groups).toEqual([]);
  });

  it("a populated project → type → doc tree (main + worktree provenance) round-trips", () => {
    const populated = {
      ...MINIMAL,
      groups: [
        {
          group: GROUP,
          types: [
            {
              type: "spec",
              docs: [
                {
                  docId: "doc:company:main:specs/x.md",
                  repoKey: "company",
                  checkoutId: "main",
                  checkoutKey: "company",
                  relPath: "specs/x.md",
                  worktreeName: null,
                  branch: null,
                  provenance: "main",
                  title: "X",
                  status: "shipped",
                  owner: "joe",
                  lastUpdated: "2026-07-01",
                  statusVerifiedAt: null,
                  description: "A doc.",
                  mtime: "2026-06-23T01:00:00.000Z",
                },
                {
                  docId: "doc:company:worktree:abc:specs/x.md",
                  repoKey: "company",
                  checkoutId: "worktree:abc",
                  checkoutKey: "company::wt::abc",
                  relPath: "specs/x.md",
                  worktreeName: "cos-COS-1",
                  branch: "docs/COS-1",
                  provenance: "worktree",
                  title: "X (worktree)",
                  status: "draft",
                  owner: null,
                  lastUpdated: null,
                  statusVerifiedAt: null,
                  description: null,
                  mtime: "2026-06-23T02:00:00.000Z",
                },
              ],
            },
            { type: "review", docs: [] },
          ],
        },
      ],
    };
    const parsed = parseDocIndexV1(populated);
    const docs = parsed.groups[0]!.types[0]!.docs;
    expect(docs[0]!.provenance).toBe("main");
    expect(docs[0]!.worktreeName).toBeNull();
    expect(docs[1]!.provenance).toBe("worktree");
    expect(docs[1]!.checkoutKey).toBe("company::wt::abc");
    expect(parsed.groups[0]!.types[1]!.type).toBe("review");
  });

  it("rejects a malformed doc-index type", () => {
    const bad = { ...MINIMAL, groups: [{ group: GROUP, types: [{ type: "bogus", docs: [] }] }] };
    expect(safeParseDocIndexV1(bad).success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    expect(docIndexV1Schema.safeParse({ ...MINIMAL, schemaVersion: 99 }).success).toBe(false);
  });

  it("exposes the index-time cap constants", () => {
    expect(DOC_FRONTMATTER_SCAN_BYTES).toBe(8192); // WF-09 shared-parser head-budget parity (codex order-0 fold)
    expect(MAX_DOCS_PER_REPO).toBe(600);
  });
});
