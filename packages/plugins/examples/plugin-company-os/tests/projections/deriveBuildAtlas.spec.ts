import { describe, it, expect } from "vitest";
import { deriveBuildAtlas } from "../../src/projections/deriveBuildAtlas.js";
import { bundleOf, docSignal, lineageSignal, taxon, ticketSignal, work, NOW } from "../fixtures/signals.js";
import { buildCorpus, corpusSignals, EXPECTED } from "../fixtures/tickets.js";
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
        // isRolling now rides on the registry-sourced signal (COS-5g), not a
        // hardcoded set — the 6th arg mirrors `is_rolling: true` in the registry.
        taxon("INFRA", "Infrastructure", "Company", "Platform", false, true),
        work("INFRA-1", "shipped", "commit_scope", { prefix: "INFRA" }),
      ]),
      NOW,
    );
    const infra = atlas.families.find((f) => f.prefix === "INFRA");
    expect(infra?.isRolling).toBe(true);
    expect(infra?.builtSummary).toBe("1 shipped · live");
  });

  it("a non-rolling family (registry is_rolling unset) shows a fixed built ratio", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("OB", "Onboarding", "JB", "Onboarding"), // isRolling defaults false
        work("OB-1", "shipped", "commit_scope", { prefix: "OB" }),
      ]),
      NOW,
    );
    const ob = atlas.families.find((f) => f.prefix === "OB");
    expect(ob?.isRolling).toBe(false);
    expect(ob?.builtSummary).toBe("1/1 shipped");
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

  it("drops an unregistered LANE family ref with a broken_edge diagnostic (codex 5b P1)", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        ...families(),
        lineageSignal({
          laneGroups: [{ id: "vc", title: "VC", kind: "flow", lanes: [{ id: "l", title: "L", families: ["MTP", "COX", "TAP", "COS"] }] }],
          edges: [],
        }),
      ]),
      NOW,
    );
    // COX is dropped from the persisted lane...
    expect(atlas.laneGroups[0].lanes[0].families).toEqual(["MTP", "TAP", "COS"]);
    // ...with a broken_edge diagnostic naming it.
    const diag = atlas.diagnostics.find((d) => d.code === "broken_edge" && d.prefix === "COX");
    expect(diag?.message).toContain("lane");
  });

  it("flags orphans even when laneGroups is empty but the signal is present (edges-only graph)", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([...families(), lineageSignal({ laneGroups: [], edges: [{ from: "TAP", to: "MTP", kind: "consumes" }] })]),
      NOW,
    );
    // Every family is orphaned (no lanes) — the signal is present, so it is flagged.
    expect(atlas.diagnostics.filter((d) => d.code === "orphan_family").map((d) => d.prefix).sort()).toEqual(["COS", "MTP", "TAP"]);
  });

  it("uses the last lineage signal when more than one is present (single-signal design)", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        ...families(),
        lineageSignal({ laneGroups: [{ id: "old", title: "Old", kind: "flow", lanes: [{ id: "o", title: "O", families: ["MTP"] }] }], edges: [] }),
        lineageSignal({ laneGroups: [{ id: "new", title: "New", kind: "flow", lanes: [{ id: "n", title: "N", families: ["MTP", "TAP", "COS"] }] }], edges: [] }),
      ]),
      NOW,
    );
    expect(atlas.laneGroups.map((g) => g.id)).toEqual(["new"]);
  });
});

describe("deriveBuildAtlas (5c — LYC three-tier routing)", () => {
  const corpusTaxa = () => [
    taxon("MTP", "Movement", "JB", "Coaching"),
    taxon("SSF", "Self-reported", "JB", "Sales"),
    taxon("COS", "Company OS", "Company", "Company-OS"),
    taxon("LYC", "Lycaon", "Company", "Meta"),
  ];
  const atlasOf = () => deriveBuildAtlas(bundleOf([...corpusTaxa(), ...corpusSignals()]), NOW);
  const fam = (atlas: ReturnType<typeof atlasOf>, prefix: string) =>
    atlas.families.find((f) => f.prefix === prefix);

  it("the 500-issue corpus has the documented origin/status distribution (oracle invariant)", () => {
    const c = buildCorpus();
    expect(c).toHaveLength(EXPECTED.total); // 500
    const byOrigin = (o: string) => c.filter((t) => t.originKind === o).length;
    expect(byOrigin("routine_execution")).toBe(227);
    expect(byOrigin("issue_productivity_review")).toBe(EXPECTED.productivityReviewDropped); // 22
    expect(byOrigin("manual")).toBe(251);
    const doneManual = c.filter((t) => t.originKind === "manual" && ["done", "cancelled"].includes(t.status));
    expect(doneManual).toHaveLength(EXPECTED.doneExcluded); // 31
    // Firing-level accounting must close to 500: routine firings + review + routed
    // family + ops + done-excluded manual.
    expect(227 + EXPECTED.productivityReviewDropped + EXPECTED.mtpTickets + EXPECTED.ssfTickets + EXPECTED.opsUnrouted + EXPECTED.doneExcluded).toBe(EXPECTED.total);
  });

  it("routes the full corpus with the expected counts (manual → family, routine/ops → Meta)", () => {
    const atlas = atlasOf();
    expect(fam(atlas, "MTP")?.tickets).toHaveLength(EXPECTED.mtpTickets);
    expect(fam(atlas, "SSF")?.tickets).toHaveLength(EXPECTED.ssfTickets);
    expect(fam(atlas, "MTP")?.tickets.every((t) => t.route === "family")).toBe(true);

    const meta = fam(atlas, "META");
    expect(meta).toBeDefined();
    expect(meta?.tickets).toHaveLength(EXPECTED.metaTickets);
    expect(meta?.tickets.filter((t) => t.route === "routine")).toHaveLength(EXPECTED.routineChips);
    expect(meta?.tickets.filter((t) => t.route === "ops")).toHaveLength(EXPECTED.opsUnrouted);
  });

  it("collapses routine_execution firings to one chip per routine definition", () => {
    const routineChips = fam(atlasOf(), "META")?.tickets.filter((t) => t.route === "routine") ?? [];
    expect(routineChips).toHaveLength(EXPECTED.routineChips);
    // Each chip is a definition, not a firing — its title carries the run count.
    expect(routineChips.every((c) => /·\s+\d+\s+runs?\b/.test(c.title ?? ""))).toBe(true);
    expect(routineChips.every((c) => c.originKind === "routine_execution")).toBe(true);
  });

  it("drops issue_productivity_review entirely (never in any family or Meta)", () => {
    const atlas = atlasOf();
    const allTickets = atlas.families.flatMap((f) => f.tickets);
    expect(allTickets.some((t) => t.originKind === "issue_productivity_review")).toBe(false);
  });

  it("excludes done/cancelled manual tickets from the active Atlas", () => {
    // 31 done/cancelled manual tickets reference MTP but must NOT appear as MTP builds/tickets.
    expect(fam(atlasOf(), "MTP")?.tickets).toHaveLength(EXPECTED.mtpTickets); // 140, not 140+31
  });

  it("routes a multi-family manual ticket to the first family and keeps extras as lineage tags", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("MTP", "Movement", "JB", "Coaching"),
        taxon("COS", "Company OS", "Company", "Company-OS"),
        ticketSignal("LYC-9", { originKind: "manual", status: "in_progress", referencedFamilies: ["MTP", "COS"] }),
      ]),
      NOW,
    );
    const mtp = atlas.families.find((f) => f.prefix === "MTP");
    expect(mtp?.tickets.map((t) => t.identifier)).toEqual(["LYC-9"]);
    expect(mtp?.lineageTags).toContain("COS"); // the extra family surfaces as a lineage tag
    expect(atlas.families.find((f) => f.prefix === "COS")?.tickets).toEqual([]);
  });

  it("parks a manual ticket with no registered family in Meta·Ops with an unrouted diagnostic", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("MTP", "Movement", "JB", "Coaching"),
        ticketSignal("LYC-42", { originKind: "manual", status: "todo", referencedFamilies: ["ZZZ"] }),
      ]),
      NOW,
    );
    const meta = atlas.families.find((f) => f.prefix === "META");
    expect(meta?.tickets.map((t) => [t.identifier, t.route])).toEqual([["LYC-42", "ops"]]);
    expect(atlas.diagnostics.filter((d) => d.code === "unrouted_ticket")).toHaveLength(1);
  });

  it("emits no Meta family and no ticket routing when there are no ticket signals (backward-compat)", () => {
    const atlas = deriveBuildAtlas(bundleOf([taxon("COS", "Company OS", "Company", "Company-OS")]), NOW);
    expect(atlas.families.map((f) => f.prefix)).toEqual(["COS"]);
    expect(atlas.diagnostics.filter((d) => d.code === "unrouted_ticket")).toEqual([]);
  });

  it("excludes the self-prefix from routing (an LYC ticket referencing only LYC parks in Ops)", () => {
    const atlas = deriveBuildAtlas(
      bundleOf([
        taxon("LYC", "Lycaon", "Company", "Meta"),
        ticketSignal("LYC-5", { originKind: "manual", status: "todo", referencedFamilies: ["LYC"] }),
      ]),
      NOW,
    );
    expect(atlas.families.find((f) => f.prefix === "LYC")?.tickets).toEqual([]);
    expect(atlas.families.find((f) => f.prefix === "META")?.tickets.map((t) => t.route)).toEqual(["ops"]);
  });

  it("the routed Atlas still validates against the persisted contract", () => {
    expect(() => parseBuildAtlasV1(atlasOf())).not.toThrow();
  });
});
