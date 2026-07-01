import { describe, expect, it } from "vitest";
import { artifactSource } from "../../src/sources/ArtifactSource.js";
import { isArtifactSignal } from "../../src/contracts/signals.js";
import { fixtureHash, makeFixtureContext } from "../fixtures/context.js";

describe("ArtifactSource", () => {
  it("indexes spec/handoff/cannons by frontmatter type, with hash + size + mtime", async () => {
    const specBody = `---\ntype: spec\nsystem: Company\nprefix: COS\nstatus: approved\ntitle: Cockpit\ncreated_by: "Librarian Agent (Paperclip)"\n---\nbody`;
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "docs/superpowers/specs/2026-06-23-COS-0.md": { content: specBody, mtime: "2026-06-23T00:00:00.000Z", sizeBytes: 999 },
          "reports/handoffs/2026-06-23-x.md": { content: `---\ntype: handoff\n---\n` },
          "reports/review-cannons/c.md": { content: `---\ntype: cannons-report\nverdict: ship\n---\n` },
        },
      },
    });
    const arts = (await artifactSource.collect(ctx)).signals.filter(isArtifactSignal);
    const byType = Object.fromEntries(arts.map((a) => [a.artifactType, a]));
    expect(Object.keys(byType).sort()).toEqual(["cannons", "handoff", "spec"]);
    expect(byType.spec).toMatchObject({
      system: "Company",
      prefix: "COS",
      status: "approved",
      title: "Cockpit",
      createdBy: "Librarian Agent (Paperclip)",
      sizeBytes: 999,
      sha256: fixtureHash(specBody),
      mtime: "2026-06-23T00:00:00.000Z",
    });
  });

  it("falls back to a path heuristic when frontmatter lacks a type", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "specs/OB-01.md": { content: `---\nstatus: done\n---\n` } } },
    });
    const arts = (await artifactSource.collect(ctx)).signals.filter(isArtifactSignal);
    expect(arts[0]).toMatchObject({ artifactType: "spec", prefix: "OB", createdBy: null });
  });

  it("skips a doc that matches no glob/type rather than mis-indexing", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "README.md": { content: "# readme" } } },
    });
    expect((await artifactSource.collect(ctx)).signals).toEqual([]);
  });

  it("indexes ANY reports/** dir as routine_output so new AGENTS routine dirs are caught (P1-1)", async () => {
    // The live AGENTS company_os blocks write to reports/{strategy,health,process,journal,harvest}/
    // — none of which were in the old hardcoded glob list. The broad reports/** glob + the
    // typeFromPath catch-all must index them as routine_output so the routine-health join works.
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "reports/strategy/2026-06-23.md": { content: "# Weekly strategy" },
          "reports/health/2026-06-23.md": { content: "# Daily health scan" },
          "reports/journal/2026/06-23.md": { content: "# Codebase awareness (date-bucketed)" },
        },
      },
    });
    const arts = (await artifactSource.collect(ctx)).signals.filter(isArtifactSignal);
    expect(arts.map((a) => a.relPath).sort()).toEqual([
      "reports/health/2026-06-23.md",
      "reports/journal/2026/06-23.md",
      "reports/strategy/2026-06-23.md",
    ]);
    expect(arts.every((a) => a.artifactType === "routine_output")).toBe(true);
  });
});
