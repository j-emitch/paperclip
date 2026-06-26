import { describe, expect, it, vi } from "vitest";
import { branchSource } from "../../src/sources/BranchSource.js";
import { docsSource } from "../../src/sources/DocsSource.js";
import { isBranchSignal, isDocSignal, isRepoGitSignal } from "../../src/contracts/signals.js";
import { MAX_CONFLICT_CHECKS } from "../../src/contracts/git-state.js";
import { MAX_DOCS_PER_REPO } from "../../src/contracts/doc-index.js";
import { FAIL, OK, forEachRef, gitFixtureContext, type GitFixtureOpts } from "../fixtures/git.js";
import { makeFixtureContext, type FixtureFs } from "../fixtures/context.js";

/**
 * Worst-case fixtures across the cost caps (spec §11 performance AC): the hard
 * assertions are the CAPS + the diagnostics (no silent truncation, no dropped
 * rows). A wall-clock bound is advisory.
 */
describe("COS-1 source cost caps (worst-case, no silent truncation)", () => {
  it("BranchSource caps conflict checks across many ahead-AND-behind branches, never dropping a row", async () => {
    const N = MAX_CONFLICT_CHECKS + 20;
    const rows = Array.from({ length: N }, (_, i) => [`b${i}`, `s${i}`, "2026-06-23T00:00:00.000Z"] as const);
    const handler: GitFixtureOpts["handler"] = (_repo, args) => {
      switch (args[0]) {
        case "rev-parse":
          return args.includes("origin/main^{commit}") ? OK("trunk") : FAIL("", 128);
        case "for-each-ref":
          return OK(forEachRef(rows));
        case "worktree":
          return OK("");
        case "merge-base":
          return OK("base");
        case "rev-list":
          return OK("1\t1"); // every branch ahead AND behind → conflict-eligible
        case "merge-tree":
          return OK("");
        default:
          return OK("");
      }
    };
    const t0 = Date.now();
    const batch = await branchSource.collect(gitFixtureContext({ handler }));
    const elapsed = Date.now() - t0;

    const branches = batch.signals.filter(isBranchSignal);
    expect(branches).toHaveLength(N); // never drops a row
    expect(branches.filter((b) => b.conflictsWithTrunk !== null).length).toBeLessThanOrEqual(MAX_CONFLICT_CHECKS);
    expect(batch.signals.filter(isRepoGitSignal)[0]!.diagnostics.some((d) => d.code === "conflict_check_capped")).toBe(true);
    expect(elapsed).toBeLessThan(2000); // advisory
  });

  it("DocsSource caps at MAX_DOCS_PER_REPO, reads head-only, and diagnoses the truncation", async () => {
    const files: Record<string, { content: string }> = {};
    for (let i = 0; i < MAX_DOCS_PER_REPO + 50; i++) files[`specs/s${i}.md`] = { content: `# Spec ${i}` };
    const ctx = makeFixtureContext({ repos: [{ repo: "company", available: true }], files: { company: files } as FixtureFs });
    const headSpy = vi.spyOn(ctx.fs, "readTextHead");
    const textSpy = vi.spyOn(ctx.fs, "readText");

    const batch = await docsSource.collect(ctx);

    expect(batch.signals.filter(isDocSignal)).toHaveLength(MAX_DOCS_PER_REPO);
    expect(batch.repoFreshness[0]!.errors.some((e) => e.code === "truncated")).toBe(true);
    expect(headSpy).toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled(); // head-only, never the full body
  });
});
