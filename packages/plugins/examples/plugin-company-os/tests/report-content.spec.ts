/**
 * `readReportContent` gate logic (spec §7) with injected deps — proves every
 * refusal branch (not-indexed / unsupported / too-large / denied / not-found)
 * and the `ok` markdown + text reads, WITHOUT touching a filesystem. The real fs
 * containment is proven separately in `workspace-fs.spec.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { readReportContent, type ReportContentDeps, DOCS_VIEWER_MAX_BYTES, extnameLower } from "../src/report-content-read.js";
import type { ArtifactEntry, ArtifactIndexV1 } from "../src/contracts/index.js";

function entry(over: Partial<ArtifactEntry> & Pick<ArtifactEntry, "repo" | "relPath">): ArtifactEntry {
  return {
    artifactType: "spec",
    system: "Company",
    prefix: "COS",
    status: null,
    sha256: "abc",
    sizeBytes: 1000,
    mtime: "2026-06-23T10:00:00.000Z",
    title: "A doc",
    ...over,
  };
}

function index(entries: ArtifactEntry[]): ArtifactIndexV1 {
  return { schemaVersion: 1, derivedAt: "2026-06-23T12:00:00.000Z", entries, countsByType: {}, sources: [], diagnostics: [] };
}

const SPEC = entry({ repo: "company", relPath: "specs/a.md", artifactType: "spec", title: "Spec A" });

function deps(over: Partial<ReportContentDeps> = {}): ReportContentDeps {
  return {
    readIndex: async () => index([SPEC]),
    readFile: async () => ({ content: "# Spec A\n\nbody", sizeBytes: 14, mtime: "2026-06-23T10:00:00.000Z" }),
    repoConfigured: () => true,
    ...over,
  };
}

describe("readReportContent", () => {
  it("serves an indexed markdown file as ok/markdown with content", async () => {
    const r = await readReportContent(deps(), "co", "company", "specs/a.md");
    expect(r.status).toBe("ok");
    expect(r.renderMode).toBe("markdown");
    expect(r.content).toContain("# Spec A");
    expect(r.title).toBe("Spec A");
    expect(r.artifactType).toBe("spec");
    expect(r.message).toBeNull();
  });

  it("serves a .txt file as ok/text", async () => {
    const txt = entry({ repo: "company", relPath: "notes/log.txt", artifactType: "routine_output" });
    const r = await readReportContent(
      deps({ readIndex: async () => index([txt]), readFile: async () => ({ content: "plain text", sizeBytes: 10, mtime: "x" }) }),
      "co",
      "company",
      "notes/log.txt",
    );
    expect(r.status).toBe("ok");
    expect(r.renderMode).toBe("text");
  });

  it("refuses a path not in the index (never reads arbitrary files)", async () => {
    const readFile = vi.fn(deps().readFile);
    const r = await readReportContent(deps({ readFile }), "co", "company", "etc/passwd");
    expect(r.status).toBe("not_indexed");
    expect(r.content).toBeNull();
    expect(readFile).not.toHaveBeenCalled(); // refused BEFORE any fs touch
  });

  it("refuses a non-allowlisted extension as unsupported_type", async () => {
    const png = entry({ repo: "company", relPath: "assets/diagram.png", artifactType: "spec" });
    const r = await readReportContent(deps({ readIndex: async () => index([png]) }), "co", "company", "assets/diagram.png");
    expect(r.status).toBe("unsupported_type");
    expect(r.renderMode).toBe("none");
  });

  it("refuses an oversize file BEFORE reading it", async () => {
    const big = entry({ repo: "company", relPath: "specs/a.md", sizeBytes: DOCS_VIEWER_MAX_BYTES + 1 });
    const readFile = vi.fn(deps().readFile);
    const r = await readReportContent(deps({ readIndex: async () => index([big]), readFile }), "co", "company", "specs/a.md");
    expect(r.status).toBe("too_large");
    expect(readFile).not.toHaveBeenCalled();
    expect(r.message).toMatch(/MB/);
  });

  it("maps a containment refusal from the reader to `denied`", async () => {
    const r = await readReportContent(
      deps({ readFile: async () => { throw new Error("path escapes workspace: specs/a.md"); } }),
      "co",
      "company",
      "specs/a.md",
    );
    expect(r.status).toBe("denied");
    expect(r.content).toBeNull();
  });

  it("maps a generic read error to `not_found`", async () => {
    const r = await readReportContent(
      deps({ readFile: async () => { throw new Error("ENOENT: no such file"); } }),
      "co",
      "company",
      "specs/a.md",
    );
    expect(r.status).toBe("not_found");
  });

  it("refuses when the repo is not configured", async () => {
    const r = await readReportContent(deps({ repoConfigured: () => false }), "co", "company", "specs/a.md");
    expect(r.status).toBe("not_found");
  });

  it("treats an empty selection as a clean not_found (no index read needed)", async () => {
    const readIndex = vi.fn(deps().readIndex);
    const r = await readReportContent(deps({ readIndex }), "co", "", "");
    expect(r.status).toBe("not_found");
    expect(readIndex).not.toHaveBeenCalled();
  });

  it("refuses everything when the index is null/cold", async () => {
    const r = await readReportContent(deps({ readIndex: async () => null }), "co", "company", "specs/a.md");
    expect(r.status).toBe("not_indexed");
  });

  it("re-checks size on the real read (race) and refuses if it grew", async () => {
    const r = await readReportContent(
      deps({ readFile: async () => ({ content: "x", sizeBytes: DOCS_VIEWER_MAX_BYTES + 5, mtime: "x" }) }),
      "co",
      "company",
      "specs/a.md",
    );
    expect(r.status).toBe("too_large");
  });

  it("never returns an absolute path and nulls content on every refusal", async () => {
    const statuses = ["not_indexed", "unsupported_type", "too_large", "denied", "not_found"] as const;
    const results = await Promise.all([
      readReportContent(deps({ readIndex: async () => index([]) }), "co", "company", "specs/a.md"),
      readReportContent(deps({ readIndex: async () => index([entry({ repo: "company", relPath: "x.png" })]) }), "co", "company", "x.png"),
      readReportContent(deps({ readIndex: async () => index([entry({ repo: "company", relPath: "specs/a.md", sizeBytes: 9_000_000 })]) }), "co", "company", "specs/a.md"),
      readReportContent(deps({ readFile: async () => { throw new Error("path escapes workspace"); } }), "co", "company", "specs/a.md"),
      readReportContent(deps({ repoConfigured: () => false }), "co", "company", "specs/a.md"),
    ]);
    for (const r of results) {
      expect(statuses).toContain(r.status);
      expect(r.content).toBeNull();
      expect(r.relPath.startsWith("/")).toBe(false);
    }
  });

  it("extnameLower extracts lowercase extensions", () => {
    expect(extnameLower("a/B.MD")).toBe(".md");
    expect(extnameLower("x.markdown")).toBe(".markdown");
    expect(extnameLower("noext")).toBe("");
    expect(extnameLower("dir.with.dots/file.TXT")).toBe(".txt");
  });
});
