import { describe, expect, it } from "vitest";
import { deriveBoardState } from "../../src/projections/deriveBoardState.js";
import { deriveArtifactIndex } from "../../src/projections/deriveArtifactIndex.js";
import { deriveRoutineHealth } from "../../src/projections/deriveRoutineHealth.js";
import { deriveSkillsCatalog } from "../../src/projections/deriveSkillsCatalog.js";
import { NOW, agentSignal, branchSignal, bundleOf, docSignal, repoGitSignal, taxon, work } from "../fixtures/signals.js";

/**
 * The COS-0 regression guard: the four new signal kinds (branch / repo_git /
 * doc / agent) must be IGNORED by the existing folds (filter-in, no exhaustive switch), so
 * adding them to the bundle leaves every COS-0 projection byte-identical.
 */
describe("COS-0 projections ignore the new COS-1 signal kinds", () => {
  const base = [
    taxon("COS", "Company OS", "Company", "Company-OS"),
    work("COS-0", "in_progress", "branch_path", { repo: "company" }),
  ];
  const without = bundleOf(base);
  const withNew = bundleOf([
    ...base,
    branchSignal("main", { repo: "company" }),
    repoGitSignal("company"),
    docSignal("specs/x.md", { repo: "company" }),
    agentSignal("cto", { displayName: "CTO" }),
  ]);

  it("deriveBoardState output is identical with/without the new kinds", () => {
    expect(JSON.stringify(deriveBoardState(withNew, NOW))).toBe(JSON.stringify(deriveBoardState(without, NOW)));
  });
  it("deriveArtifactIndex output is identical with/without the new kinds", () => {
    expect(JSON.stringify(deriveArtifactIndex(withNew, NOW))).toBe(JSON.stringify(deriveArtifactIndex(without, NOW)));
  });
  it("deriveRoutineHealth output is identical with/without the new kinds", () => {
    expect(JSON.stringify(deriveRoutineHealth(withNew, NOW))).toBe(JSON.stringify(deriveRoutineHealth(without, NOW)));
  });
  it("deriveSkillsCatalog output is identical with/without the agent kind", () => {
    expect(JSON.stringify(deriveSkillsCatalog(withNew, NOW))).toBe(JSON.stringify(deriveSkillsCatalog(without, NOW)));
  });
});
