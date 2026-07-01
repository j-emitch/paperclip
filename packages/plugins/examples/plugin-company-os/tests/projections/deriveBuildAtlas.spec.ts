import { describe, it, expect } from "vitest";
import { deriveBuildAtlas } from "../../src/projections/deriveBuildAtlas.js";
import { bundleOf, docSignal, lineageSignal, taxon, work, NOW } from "../fixtures/signals.js";
import { parseBuildAtlasV1 } from "../../src/contracts/build-atlas.js";

describe("deriveBuildAtlas (5a — families + lifecycle)", () => {
  it("seeds a family per registered prefix, even with zero work (show-0)", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        taxon("PULSE", "Pulse", "JB", "Observability"),
      ]),
      NOW,
    );
    expect(atlas.families.map((f) => f.prefix)).toEqual(["COS", "PULSE"]);
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.builds).toEqual([]);
    expect(cos?.builtPct).toBe(0);
    expect(cos?.builtSummary).toBe("no builds yet");
  });

  it("validates against the persisted contract", () => {
    const atlas = deriveBuildAtlas(bundleOf([taxon("COS", "Company OS", "JB", "Company-OS")]), NOW);
    expect(() => parseBuildAtlasV1(atlas)).not.toThrow();
  });

  it("folds builds by ticket, furthest-right state wins, and computes builtPct", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        work("COS-1", "shipped", "commit_scope", { prefix: "COS" }),
        work("COS-1", "in_progress", "branch_path", { prefix: "COS" }), // same ticket → furthest-right = shipped
        work("COS-2", "in_progress", "branch_path", { prefix: "COS" }),
      ]),
      NOW,
    );
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.builds.map((b) => [b.ticketId, b.state])).toEqual([
      ["COS-1", "shipped"],
      ["COS-2", "in_progress"],
    ]);
    expect(cos?.builtPct).toBe(50); // 1 of 2 shipped
    expect(cos?.builtSummary).toBe("1/2 shipped");
  });

  it("marks rolling families '· live' rather than a fixed %", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("INFRA", "Infrastructure", "Company", "Platform"),
        work("INFRA-1", "shipped", "commit_scope", { prefix: "INFRA" }),
      ]),
      NOW,
    );
    const infra = atlas.families.find((f) => f.prefix === "INFRA");
    expect(infra?.isRolling).toBe(true);
    expect(infra?.builtSummary).toBe("1 shipped · live");
  });

  it("does not count a reverted-only ship as a build", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", reverted: true }),
      ]),
      NOW,
    );
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.builds).toEqual([]);
    // The lifecycle must agree — no phantom shipped build.
    expect(cos?.lifecycle.build).toBe("todo");
    expect(cos?.lifecycle.prod).toBe("todo");
  });

  it("ship-then-revert (newest wins) → not shipped; builtPct 0; lifecycle build todo", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", mtime: "2026-05-01T00:00:00.000Z" }),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", reverted: true, mtime: "2026-05-02T00:00:00.000Z" }),
      ]),
      NOW,
    );
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.builds).toEqual([]);
    expect(cos?.builtPct).toBe(0);
    expect(cos?.lifecycle.build).toBe("todo");
  });

  it("revert-then-reship (newest wins) → shipped again", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", mtime: "2026-05-01T00:00:00.000Z" }),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", reverted: true, mtime: "2026-05-02T00:00:00.000Z" }),
        work("COS-9", "shipped", "commit_scope", { prefix: "COS", mtime: "2026-05-03T00:00:00.000Z" }),
      ]),
      NOW,
    );
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.builds.map((b) => [b.ticketId, b.state])).toEqual([["COS-9", "shipped"]]);
    expect(cos?.builtPct).toBe(100);
    expect(cos?.lifecycle.build).toBe("done");
    expect(cos?.lifecycle.prod).toBe("active");
  });

  it("attaches lifecycle from the family's spec/plan docs", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        docSignal("specs/COS-1.md", { docType: "spec", prefix: "COS", verified: true }),
        docSignal("docs/superpowers/plans/COS-1-plan.md", { docType: "plan", prefix: "COS", verified: false }),
        work("COS-1", "in_progress", "branch_path", { prefix: "COS" }),
      ]),
      NOW,
    );
    const cos = atlas.families.find((f) => f.prefix === "COS");
    expect(cos?.lifecycle).toEqual({
      spec: "done",
      plan: "active",
      build: "active",
      prod: "todo",
      planState: "authored",
    });
  });

  it("groups families into domains by L1 system", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        taxon("LDI", "Data Ingest", "ARC", "Pipeline"),
      ]),
      NOW,
    );
    expect(atlas.domains).toEqual([
      { id: "ARC", title: "ARC", families: ["LDI"] },
      { id: "JB", title: "JB", families: ["COS"] },
    ]);
  });

  it("raises an unknown_prefix diagnostic for work referencing an unregistered prefix", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        work("XYZ-1", "in_progress", "branch_path", { prefix: "XYZ" }),
      ]),
      NOW,
    );
    const diag = atlas.diagnostics.find((d) => d.code === "unknown_prefix");
    expect(diag?.prefix).toBe("XYZ");
    // The unregistered family is not fabricated as a card.
    expect(atlas.families.map((f) => f.prefix)).toEqual(["COS"]);
  });

  it("leaves lineage empty (and no orphan diagnostics) when no lineage signal is present", () => {
    const atlas = deriveBuildAtlas(bundleOf([taxon("COS", "Company OS", "JB", "Company-OS")]), NOW);
    expect(atlas.laneGroups).toEqual([]);
    expect(atlas.edges).toEqual([]);
    expect(atlas.families[0]?.lineageTags).toEqual([]);
    expect(atlas.diagnostics.some((d) => d.code === "orphan_family")).toBe(false);
  });
});

describe("deriveBuildAtlas (5b — lineage fold)", () => {
  const graph = () =>
    lineageSignal({
      laneGroups: [
        { id: "vc", title: "Value Chain", kind: "flow", lanes: [{ id: "coach", title: "Coaching", families: ["MTP", "TAP"] }] },
        { id: "sb", title: "Second Brain", kind: "second-brain", lanes: [{ id: "os", title: "OS", families: ["COS"] }] },
      ],
      edges: [
        { from: "TAP", to: "MTP", kind: "consumes" },
        { from: "COS", to: "MTP", kind: "observes" },
      ],
    });

  const families = () => [
    taxon("MTP", "Coaching", "JB", "Coaching"),
    taxon("TAP", "Tap", "JB", "Coaching"),
    taxon("COS", "Company OS", "JB", "Company-OS"),
  ];

  it("folds lane-groups + validated edges + per-family lineage tags", () => {
    const atlas = deriveBuildAtlas(bundleOf([...families(), graph()]), NOW);
    expect(atlas.laneGroups.map((g) => g.id)).toEqual(["vc", "sb"]);
    expect(atlas.edges).toHaveLength(2);
    const mtp = atlas.families.find((f) => f.prefix === "MTP");
    // MTP is the 'to' of TAP→MTP and COS→MTP → tagged with both counterparts.
    expect(mtp?.lineageTags).toEqual(["COS", "TAP"]);
    const tap = atlas.families.find((f) => f.prefix === "TAP");
    expect(tap?.lineageTags).toEqual(["MTP"]);
  });

  it("drops a broken edge (unregistered family) with a broken_edge diagnostic", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        ...families(),
        lineageSignal({
          laneGroups: [{ id: "vc", title: "VC", kind: "flow", lanes: [{ id: "l", title: "L", families: ["MTP", "TAP", "COS"] }] }],
          edges: [{ from: "MTP", to: "ZZZ", kind: "dep" }],
        }),
      ]),
      NOW,
    );
    expect(atlas.edges).toEqual([]); // the broken edge is dropped
    const diag = atlas.diagnostics.find((d) => d.code === "broken_edge");
    expect(diag?.prefix).toBe("ZZZ");
    // No phantom tag from the dropped edge.
    expect(atlas.families.find((f) => f.prefix === "MTP")?.lineageTags).toEqual([]);
  });

  it("raises orphan_family for a registered family in no lane", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        ...families(),
        lineageSignal({
          // COS is deliberately left out of every lane.
          laneGroups: [{ id: "vc", title: "VC", kind: "flow", lanes: [{ id: "l", title: "L", families: ["MTP", "TAP"] }] }],
          edges: [],
        }),
      ]),
      NOW,
    );
    const orphan = atlas.diagnostics.find((d) => d.code === "orphan_family");
    expect(orphan?.prefix).toBe("COS");
  });

  it("has zero orphans + zero broken edges when the graph covers the family set", () => {
    const atlas = deriveBuildAtlas(bundleOf([...families(), graph()]), NOW);
    expect(atlas.diagnostics.some((d) => d.code === "orphan_family")).toBe(false);
    expect(atlas.diagnostics.some((d) => d.code === "broken_edge")).toBe(false);
  });
});
