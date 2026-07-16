import { describe, it, expect } from "vitest";
import {
  BUILD_ATLAS_SCHEMA_VERSION,
  parseBuildAtlasV1,
  safeParseBuildAtlasV1,
  type BuildAtlasV1,
} from "../../src/contracts/build-atlas.js";

function validAtlas(over: Partial<BuildAtlasV1> = {}): BuildAtlasV1 {
  return {
    schemaVersion: BUILD_ATLAS_SCHEMA_VERSION,
    derivedAt: "2026-06-23T12:00:00.000Z",
    sources: [],
    domains: [{ id: "JB", title: "JB", families: ["COS"] }],
    families: [
      {
        prefix: "COS",
        name: "Company OS",
        l1: "JB",
        l2: "Company-OS",
        domain: "JB",
        laneId: "JB:Company-OS",
        repos: ["juice-bar"],
        isGeneric: false,
        isRolling: false,
        lifecycle: { spec: "done", plan: "active", build: "active", prod: "todo", planState: "authored" },
        specStatus: "shipped",
        specUpdatedAt: "2026-06-20",
        planStatus: "active",
        planUpdatedAt: "2026-06-22",
        description: "The daily-driver cockpit.",
        builtPct: 50,
        builtSummary: "1/2 shipped",
        builds: [],
        tickets: [],
        lineageTags: [],
      },
    ],
    laneGroups: [],
    edges: [],
    diagnostics: [],
    sourceDiagnostics: [],
    ...over,
  };
}

describe("BuildAtlasV1 contract", () => {
  it("round-trips a valid atlas", () => {
    const atlas = validAtlas();
    expect(parseBuildAtlasV1(atlas)).toEqual(atlas);
    expect(safeParseBuildAtlasV1(atlas).success).toBe(true);
  });

  it("rejects a bad gate state", () => {
    const bad = validAtlas();
    // @ts-expect-error: deliberately invalid gate state for the negative test
    bad.families[0].lifecycle.spec = "shipped";
    expect(safeParseBuildAtlasV1(bad).success).toBe(false);
    expect(() => parseBuildAtlasV1(bad)).toThrow();
  });

  it("rejects an out-of-range builtPct", () => {
    const bad = validAtlas();
    bad.families[0].builtPct = 150;
    expect(safeParseBuildAtlasV1(bad).success).toBe(false);
  });

  it("rejects a wrong schemaVersion", () => {
    const bad = validAtlas();
    // @ts-expect-error: deliberately wrong literal
    bad.schemaVersion = 99;
    expect(safeParseBuildAtlasV1(bad).success).toBe(false);
  });

  it("rejects a bad lane-group kind", () => {
    const bad = validAtlas({
      laneGroups: [
        // @ts-expect-error: deliberately invalid kind
        { id: "vc", title: "Value Chain", kind: "pipeline", lanes: [] },
      ],
    });
    expect(safeParseBuildAtlasV1(bad).success).toBe(false);
  });

  it("rejects a bad lineage edge kind", () => {
    const bad = validAtlas({
      // @ts-expect-error: deliberately invalid edge kind
      edges: [{ from: "COS", to: "PULSE", kind: "relates" }],
    });
    expect(safeParseBuildAtlasV1(bad).success).toBe(false);
  });
});
