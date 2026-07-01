import { describe, expect, it } from "vitest";
import { collectAndProject } from "../../src/collect-and-project.js";
import { parseArtifactIndexV1 } from "../../src/contracts/artifact-index.js";
import { parseBoardStateV1 } from "../../src/contracts/board-state.js";
import { parseRoutineHealthV1 } from "../../src/contracts/routine-health.js";
import { parseAgentSystemV1 } from "../../src/contracts/agent-system.js";
import { parseBuildAtlasV1 } from "../../src/contracts/build-atlas.js";
import { NOW, agentSignal, artifact, bundleOf, routine, taxon, work } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

describe("collectAndProject (pure)", () => {
  it("produces all three projections, each schema-valid, from one bundle", () => {
    const bundle = bundleOf([
      taxon("COS", "Company OS", "Company", "Company-OS"),
      work("COS-0", "in_progress", "branch_path", { repo: "company" }),
      artifact("docs/superpowers/specs/COS-0.md", { repo: "company", artifactType: "spec", prefix: "COS" }),
      agentSignal("cto", { displayName: "CTO" }),
      routine("daily-standup", "daily", "company/reports/standup/*.md"),
    ]);
    const { board, artifactIndex, routineHealth, agentSystem, buildAtlas } = collectAndProject(bundle, NOW, taxonomyFixture());

    expect(() => parseBoardStateV1(board)).not.toThrow();
    expect(() => parseArtifactIndexV1(artifactIndex)).not.toThrow();
    expect(() => parseRoutineHealthV1(routineHealth)).not.toThrow();
    expect(() => parseAgentSystemV1(agentSystem)).not.toThrow();
    expect(() => parseBuildAtlasV1(buildAtlas)).not.toThrow();

    expect(board.chips.find((c) => c.id === "COS-0")?.column).toBe("in_progress");
    expect(artifactIndex.countsByType.spec).toBe(1);
    expect(routineHealth.routines[0].routineKey).toBe("daily-standup");
    expect(agentSystem.agents[0]?.displayName).toBe("CTO");
    // The COS family folds through into the Build Atlas from the same bundle.
    expect(buildAtlas.families.some((f) => f.prefix === "COS")).toBe(true);
    // derivedAt is the injected now, identical across projections (deterministic).
    expect(board.derivedAt).toBe(artifactIndex.derivedAt);
    expect(board.derivedAt).toBe(routineHealth.derivedAt);
    expect(board.derivedAt).toBe(buildAtlas.derivedAt);
  });

  it("is a pure function — same bundle + now → byte-identical output", () => {
    const bundle = bundleOf([taxon("OB", "Onboarding", "JB", "Onboarding"), work("OB-01", "shipped", "commit_scope", { sha: "m1" })]);
    expect(JSON.stringify(collectAndProject(bundle, NOW, taxonomyFixture()))).toBe(
      JSON.stringify(collectAndProject(bundle, NOW, taxonomyFixture())),
    );
  });
});
